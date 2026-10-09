import type {
  Account,
  AccountTestResult,
  RemoteProvider,
  RemoteRepository,
  RemoteRepositoryMutationResult,
  RemoteRepositoryWriteInput,
} from "../../../shared/types";
import { readCredential } from "./credentials";
import {
  getAccount,
  loadAccounts,
  loadRemoteRepositoryCache,
  saveRemoteRepositoryCache,
  updateAccount,
} from "./storage";

type ProviderEndpoint = {
  url: string;
  header: string;
  prefix: string;
};

const USER_ENDPOINTS: Record<RemoteProvider, ProviderEndpoint> = {
  github: { url: "https://api.github.com/user", header: "Authorization", prefix: "Bearer " },
  gitee: { url: "https://gitee.com/api/v5/user", header: "Authorization", prefix: "token " },
  gitlab: { url: "https://gitlab.com/api/v4/user", header: "PRIVATE-TOKEN", prefix: "" },
};

const REPOSITORY_ENDPOINTS: Record<RemoteProvider, ProviderEndpoint> = {
  github: {
    url: "https://api.github.com/user/repos?per_page=100&sort=updated",
    header: "Authorization",
    prefix: "Bearer ",
  },
  gitee: {
    url: "https://gitee.com/api/v5/user/repos?per_page=100&sort=updated",
    header: "Authorization",
    prefix: "token ",
  },
  gitlab: {
    url: "https://gitlab.com/api/v4/projects?membership=true&per_page=100&order_by=updated_at",
    header: "PRIVATE-TOKEN",
    prefix: "",
  },
};

export async function resolveTokenUser(provider: RemoteProvider, token: string): Promise<{ username: string }> {
  const endpoint = USER_ENDPOINTS[provider];
  let response: Response;
  try {
    response = await fetchWithTimeout(endpoint.url, {
      headers: {
        Accept: "application/json",
        [endpoint.header]: `${endpoint.prefix}${token}`,
      },
    });
  } catch (error) {
    throw new Error(`连接远程平台失败：${errorMessage(error)}`);
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error("令牌无效或已过期");
  }
  if (!response.ok) {
    throw new Error(`平台返回 HTTP ${response.status}，请检查令牌和权限`);
  }
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const username =
    typeof body.login === "string"
      ? body.login
      : typeof body.username === "string"
        ? body.username
        : "";
  if (!username) {
    throw new Error("无法从平台读取用户名，请检查令牌权限");
  }
  return { username };
}

export async function testAccount(accountId: string): Promise<AccountTestResult> {
  const account = getAccount(accountId);
  const token = readCredential(account.credentialRef);
  const endpoint = USER_ENDPOINTS[account.provider];

  let response: Response;
  try {
    response = await fetchWithTimeout(endpoint.url, {
      headers: {
        Accept: "application/json",
        [endpoint.header]: `${endpoint.prefix}${token}`,
      },
    });
  } catch (error) {
    throw new Error(`连接远程平台失败：${errorMessage(error)}`);
  }

  if (!response.ok) {
    const status = response.status === 401 || response.status === 403 ? "invalid" : "unknown";
    updateAccount(account.id, { status });
    return {
      success: false,
      scopes: [],
      message: `平台返回 HTTP ${response.status}，请检查令牌和权限`,
    };
  }

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const username =
    typeof body.login === "string"
      ? body.login
      : typeof body.username === "string"
        ? body.username
        : account.username;

  updateAccount(account.id, {
    username,
    status: "active",
    lastCheckedAt: new Date().toISOString(),
  });

  return {
    success: true,
    username,
    scopes: account.scopes,
    message: "连接成功，令牌可用",
  };
}

export async function loadRemoteRepositories(accountId: string): Promise<RemoteRepository[]> {
  const account = getAccount(accountId);
  const token = readCredential(account.credentialRef);
  const endpoint = REPOSITORY_ENDPOINTS[account.provider];

  let repositories: RemoteRepository[] | null = null;
  try {
    repositories = await fetchRemoteRepositories(account, token, endpoint);
  } catch (error) {
    const cached = loadRemoteRepositoryCache(accountId);
    if (cached && cached.length > 0) {
      throw new Error(`${errorMessage(error)}（已加载本地缓存的 ${cached.length} 个仓库）`);
    }
    throw error;
  }

  if (repositories) {
    saveRemoteRepositoryCache(accountId, account.provider, repositories);
  }
  return repositories ?? loadRemoteRepositoryCache(accountId) ?? [];
}

export async function loadCachedRemoteRepositories(accountId: string): Promise<RemoteRepository[]> {
  return loadRemoteRepositoryCache(accountId) ?? [];
}

async function fetchRemoteRepositories(
  account: Account,
  token: string,
  endpoint: ProviderEndpoint,
): Promise<RemoteRepository[]> {
  const repositories: RemoteRepository[] = [];
  let pageUrl: string | null = endpoint.url;

  while (pageUrl) {
    let response: Response;
    try {
      response = await fetchWithTimeout(pageUrl, {
        headers: {
          Accept: "application/json",
          [endpoint.header]: `${endpoint.prefix}${token}`,
        },
      });
    } catch (error) {
      throw new Error(`读取远程仓库失败：${errorMessage(error)}`);
    }

    if (!response.ok) {
      throw new Error(`平台返回 HTTP ${response.status}，请先检查账号连接`);
    }

    const payload: unknown = await response.json().catch(() => null);
    if (!Array.isArray(payload)) {
      throw new Error("远程仓库响应格式不正确");
    }

    for (const item of payload) {
      const repository = parseRepository(account.provider, account.id, item);
      if (repository) {
        repositories.push(repository);
      }
    }

    pageUrl = nextPageUrl(account.provider, response, payload.length);
  }

  return repositories;
}

function nextPageUrl(provider: RemoteProvider, response: Response, batchSize: number): string | null {
  if (batchSize < 100) {
    return null;
  }
  const link = response.headers.get("link");
  const next = link?.match(/<([^>]+)>\s*;\s*rel="next"/)?.[1];
  if (next) {
    return next;
  }
  // Gitee 未提供 Link 头时，手动递增 page 参数（避免一次拉取遗漏）。
  if (provider === "gitee") {
    try {
      const url = new URL(response.url);
      const page = Number(url.searchParams.get("page") ?? "1");
      url.searchParams.set("page", String(page + 1));
      url.searchParams.set("per_page", "100");
      return url.toString();
    } catch {
      return null;
    }
  }
  return null;
}

export async function searchRemoteRepositories(
  provider: "github" | "gitee",
  query: string,
  accountId?: string,
): Promise<RemoteRepository[]> {
  let account: Account | null = null;
  if (accountId) {
    try {
      const candidate = getAccount(accountId);
      if (candidate.provider === provider) {
        account = candidate;
      }
    } catch {
      account = null;
    }
  }
  if (!account) {
    account = loadAccounts().find((item) => item.provider === provider) ?? null;
  }
  const token = account ? readCredential(account.credentialRef) : "";
  const endpoint = getSearchEndpoint(provider, query);

  let response: Response;
  try {
    response = await fetchWithTimeout(endpoint.url, {
      headers: {
        Accept: "application/json",
        ...(token.length > 0 ? { [endpoint.header]: `${endpoint.prefix}${token}` } : {}),
      },
    });
  } catch (error) {
    throw new Error(`搜索远程仓库失败：${errorMessage(error)}`);
  }

  if (!response.ok) {
    const hint = token.length === 0 ? "（未配置账号，建议先在「账号与令牌」添加该平台账号）" : "";
    throw new Error(`平台返回 HTTP ${response.status}${hint}`);
  }

  const payload: unknown = await response.json().catch(() => null);
  return extractSearchItems(payload)
    .map((item) => parseRepository(provider, account?.id ?? "", item))
    .filter((repository): repository is RemoteRepository => repository !== null);
}

function getSearchEndpoint(provider: "github" | "gitee", query: string): ProviderEndpoint {
  const q = encodeURIComponent(query);
  if (provider === "github") {
    return {
      url: `https://api.github.com/search/repositories?q=${q}&per_page=20&sort=stars&order=desc`,
      header: "Authorization",
      prefix: "Bearer ",
    };
  }
  return {
    url: `https://gitee.com/api/v5/search/repositories?q=${q}&per_page=20`,
    header: "Authorization",
    prefix: "token ",
  };
}

function extractSearchItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (typeof payload === "object" && payload !== null) {
    const value = payload as Record<string, unknown>;
    if (Array.isArray(value.items)) {
      return value.items;
    }
    if (Array.isArray(value.repositories)) {
      return value.repositories;
    }
  }
  return [];
}

type InteractionAction = "star" | "unstar" | "watch" | "unwatch";

function getInteractionEndpoint(provider: RemoteProvider, owner: string, name: string, action: InteractionAction): { method: string; url: string; body?: string } {
  const isStar = action === "star" || action === "unstar";
  const isOn = action === "star" || action === "watch";
  if (provider === "github") {
    if (isStar) {
      return { method: isOn ? "PUT" : "DELETE", url: `https://api.github.com/user/starred/${owner}/${name}` };
    }
    return {
      method: isOn ? "PUT" : "DELETE",
      url: `https://api.github.com/repos/${owner}/${name}/subscription`,
      body: isOn ? JSON.stringify({ subscribed: true, ignored: false }) : undefined,
    };
  }
  if (provider === "gitee") {
    if (isStar) {
      return { method: isOn ? "PUT" : "DELETE", url: `https://gitee.com/api/v5/user/starred/${owner}/${name}` };
    }
    return { method: isOn ? "PUT" : "DELETE", url: `https://gitee.com/api/v5/user/subscriptions/${owner}/${name}` };
  }
  const encoded = encodeURIComponent(`${owner}/${name}`);
  if (isStar) {
    return { method: isOn ? "POST" : "DELETE", url: `https://gitlab.com/api/v4/projects/${encoded}/${isOn ? "star" : "unstar"}` };
  }
  throw new Error("GitLab 暂不支持关注操作");
}

export async function toggleRepositoryInteraction(
  accountId: string,
  owner: string,
  name: string,
  action: InteractionAction,
): Promise<void> {
  const account = getAccount(accountId);
  const token = readCredential(account.credentialRef);
  const endpoint = getInteractionEndpoint(account.provider, owner, name, action);
  const authHeader = USER_ENDPOINTS[account.provider].header;
  const prefix = USER_ENDPOINTS[account.provider].prefix;
  let response: Response;
  try {
    response = await fetch(endpoint.url, {
      method: endpoint.method,
      headers: {
        Accept: "application/json",
        ...(endpoint.body ? { "Content-Type": "application/json" } : {}),
        [authHeader]: `${prefix}${token}`,
      },
      body: endpoint.body,
    });
  } catch (error) {
    throw new Error(`操作失败：${errorMessage(error)}`);
  }
  if (!response.ok && response.status !== 204) {
    throw new Error(`平台返回 HTTP ${response.status}`);
  }
}

export async function createRemoteRepository(
  input: RemoteRepositoryWriteInput,
): Promise<RemoteRepositoryMutationResult> {
  const account = getAccount(input.accountId);
  const token = readCredential(account.credentialRef);
  const endpoint = getCreateEndpoint(account.provider);
  const body = buildCreateBody(input);

  let response: Response;
  try {
    response = await fetchWithTimeout(endpoint.url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        [endpoint.header]: `${endpoint.prefix}${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(`创建远程仓库失败：${errorMessage(error)}`);
  }

  const payload: unknown = response.ok ? await response.json().catch(() => null) : null;
  if (!response.ok) {
    const detail = payload ? extractErrorMessage(payload) : `平台返回 HTTP ${response.status}`;
    throw new Error(`创建远程仓库失败：${detail}`);
  }
  const repository = parseRepository(account.provider, account.id, payload);
  return {
    success: true,
    message: `远程仓库 ${repository?.fullName ?? input.name} 创建成功`,
    repository: repository ?? undefined,
  };
}

export async function updateRemoteRepository(
  input: RemoteRepositoryWriteInput,
): Promise<RemoteRepositoryMutationResult> {
  const account = getAccount(input.accountId);
  const repositoryId = input.repositoryId;
  if (!repositoryId) {
    throw new Error("缺少要修改的远程仓库标识");
  }
  const token = readCredential(account.credentialRef);
  const current = await findRepository(account, token, repositoryId);
  if (!current) {
    throw new Error("远程仓库不存在或已不可见");
  }

  const endpoint = getUpdateEndpoint(account.provider, current.owner, current.name);
  const body = buildUpdateBody(input, current);

  let response: Response;
  try {
    response = await fetchWithTimeout(endpoint.url, {
      method: endpoint.method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        [endpoint.header]: `${endpoint.prefix}${token}`,
      },
      body: endpoint.method !== "GET" ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    throw new Error(`修改远程仓库失败：${errorMessage(error)}`);
  }

  const payload: unknown = response.ok ? await response.json().catch(() => null) : null;
  if (!response.ok) {
    const detail = payload ? extractErrorMessage(payload) : `平台返回 HTTP ${response.status}`;
    throw new Error(`修改远程仓库失败：${detail}`);
  }
  const repository = parseRepository(account.provider, account.id, payload);
  return {
    success: true,
    message: `远程仓库 ${repository?.fullName ?? current.fullName} 已更新`,
    repository: repository ?? undefined,
  };
}

export async function deleteRemoteRepository(
  accountId: string,
  repositoryId: string,
): Promise<RemoteRepositoryMutationResult> {
  const account = getAccount(accountId);
  const token = readCredential(account.credentialRef);
  const current = await findRepository(account, token, repositoryId);
  if (!current) {
    throw new Error("远程仓库不存在或已不可见");
  }

  const endpoint = getDeleteEndpoint(account.provider, current.owner, current.name);
  let response: Response;
  try {
    response = await fetchWithTimeout(endpoint.url, {
      method: "DELETE",
      headers: {
        Accept: "application/json",
        [endpoint.header]: `${endpoint.prefix}${token}`,
      },
    });
  } catch (error) {
    throw new Error(`删除远程仓库失败：${errorMessage(error)}`);
  }

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const detail = payload ? extractErrorMessage(payload) : `平台返回 HTTP ${response.status}`;
    throw new Error(`删除远程仓库失败：${detail}`);
  }
  return { success: true, message: `远程仓库 ${current.fullName} 已删除` };
}

async function findRepository(
  account: Account,
  token: string,
  repositoryId: string,
): Promise<RemoteRepository | null> {
  const endpoint = REPOSITORY_ENDPOINTS[account.provider];
  let response: Response;
  try {
    response = await fetchWithTimeout(endpoint.url, {
      headers: {
        Accept: "application/json",
        [endpoint.header]: `${endpoint.prefix}${token}`,
      },
    });
  } catch {
    return null;
  }
  if (!response.ok) {
    return null;
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!Array.isArray(payload)) {
    return null;
  }
  return payload
    .map((item) => parseRepository(account.provider, account.id, item))
    .find((repository) => repository !== null && repository.id === repositoryId) ?? null;
}

function getCreateEndpoint(provider: RemoteProvider): ProviderEndpoint {
  if (provider === "github") {
    return { url: "https://api.github.com/user/repos", header: "Authorization", prefix: "Bearer " };
  }
  if (provider === "gitee") {
    return { url: "https://gitee.com/api/v5/user/repos", header: "Authorization", prefix: "token " };
  }
  return {
    url: "https://gitlab.com/api/v4/projects",
    header: "PRIVATE-TOKEN",
    prefix: "",
  };
}

function getUpdateEndpoint(
  provider: RemoteProvider,
  owner: string,
  name: string,
): ProviderEndpoint & { method: string } {
  if (provider === "github") {
    return {
      url: `https://api.github.com/repos/${owner}/${name}`,
      header: "Authorization",
      prefix: "Bearer ",
      method: "PATCH",
    };
  }
  if (provider === "gitee") {
    return {
      url: `https://gitee.com/api/v5/repos/${owner}/${name}`,
      header: "Authorization",
      prefix: "token ",
      method: "PATCH",
    };
  }
  // GitLab 需要按 URL 编码路径定位仓库
  const fullPath = encodeURIComponent(`${owner}/${name}`);
  return {
    url: `https://gitlab.com/api/v4/projects/${fullPath}`,
    header: "PRIVATE-TOKEN",
    prefix: "",
    method: "PUT",
  };
}

function getDeleteEndpoint(provider: RemoteProvider, owner: string, name: string): ProviderEndpoint {
  if (provider === "github") {
    return { url: `https://api.github.com/repos/${owner}/${name}`, header: "Authorization", prefix: "Bearer " };
  }
  if (provider === "gitee") {
    return { url: `https://gitee.com/api/v5/repos/${owner}/${name}`, header: "Authorization", prefix: "token " };
  }
  const fullPath = encodeURIComponent(`${owner}/${name}`);
  return { url: `https://gitlab.com/api/v4/projects/${fullPath}`, header: "PRIVATE-TOKEN", prefix: "" };
}

function buildCreateBody(input: RemoteRepositoryWriteInput): Record<string, unknown> {
  if (input.visibility === "internal") {
    throw new Error("当前平台不支持 internal 可见性");
  }
  return {
    name: input.name,
    description: input.description,
    private: input.visibility === "private",
    auto_init: input.init,
  };
}

function buildUpdateBody(
  input: RemoteRepositoryWriteInput,
  current: RemoteRepository,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const provider = current.provider;
  if (input.name && input.name !== current.name) {
    if (provider === "github") {
      body.name = input.name;
    } else if (provider === "gitee") {
      body.name = input.name;
    } else {
      body.name = input.name;
    }
  }
  if (input.description && input.description !== current.description) {
    if (provider === "github") {
      body.description = input.description;
    } else if (provider === "gitee") {
      body.description = input.description;
    } else {
      body.description = input.description;
    }
  }
  if (input.visibility && input.visibility === "public" || input.visibility === "private") {
    if (provider === "github") {
      body.private = input.visibility === "private";
    } else if (provider === "gitee") {
      body.private = input.visibility === "private";
    } else {
      body.visibility = input.visibility;
    }
  }
  return body;
}

function extractErrorMessage(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) {
    return "未知错误";
  }
  const value = payload as Record<string, unknown>;
  if (typeof value.message === "string") {
    return value.message;
  }
  if (typeof value.error === "string") {
    return value.error;
  }
  if (Array.isArray(value.errors) && typeof value.errors[0] === "string") {
    return value.errors[0];
  }
  return "未知错误";
}

function parseRepository(
  provider: RemoteProvider,
  accountId: string,
  item: unknown,
): RemoteRepository | null {
  if (typeof item !== "object" || item === null) {
    return null;
  }
  const value = item as Record<string, unknown>;
  const name = typeof value.name === "string" ? value.name : null;
  if (!name) {
    return null;
  }

  const ownerValue = value.owner;
  const owner =
    typeof ownerValue === "object" && ownerValue !== null
      ? firstString(ownerValue as Record<string, unknown>, ["login", "username"])
      : null;
  const namespaceValue = value.namespace;
  const namespace =
    typeof namespaceValue === "object" && namespaceValue !== null
      ? firstString(namespaceValue as Record<string, unknown>, ["path"])
      : null;

  const fullName =
    firstString(value, ["full_name", "path_with_namespace"]) ?? `${owner ?? ""}/${name}`;

  return {
    id: value.id === undefined ? `${accountId}-${name}` : String(value.id),
    accountId,
    provider,
    owner: owner ?? namespace ?? "",
    name,
    fullName,
    description: firstString(value, ["description"]) ?? "",
    visibility: firstString(value, ["visibility"]) ?? "unknown",
    defaultBranch: firstString(value, ["default_branch"]) ?? "main",
    httpsUrl: firstString(value, ["clone_url", "http_url_to_repo", "html_url"]) ?? "",
    sshUrl: firstString(value, ["ssh_url", "ssh_url_to_repo"]) ?? undefined,
    webUrl: firstString(value, ["html_url", "html_url_to_repo", "web_url"]) ?? undefined,
    archived: value.archived === true,
    updatedAt: firstString(value, ["updated_at", "last_activity_at"]) ?? "",
  };
}

function firstString(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const FETCH_TIMEOUT_MS = 15 * 1000;

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("请求超时，请检查网络连接");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
