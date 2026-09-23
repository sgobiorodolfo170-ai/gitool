import type {
  Account,
  AccountTestResult,
  RemoteProvider,
  RemoteRepository,
} from "../../../shared/types";
import { readCredential } from "./credentials";
import { getAccount, updateAccount } from "./storage";

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

export async function testAccount(accountId: string): Promise<AccountTestResult> {
  const account = getAccount(accountId);
  const token = readCredential(account.credentialRef);
  const endpoint = USER_ENDPOINTS[account.provider];

  let response: Response;
  try {
    response = await fetch(endpoint.url, {
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

  let response: Response;
  try {
    response = await fetch(endpoint.url, {
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

  return payload
    .map((item) => parseRepository(account, item))
    .filter((repository): repository is RemoteRepository => repository !== null);
}

function parseRepository(account: Account, item: unknown): RemoteRepository | null {
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
    id: value.id === undefined ? `${account.id}-${name}` : String(value.id),
    accountId: account.id,
    provider: account.provider,
    owner: owner ?? namespace ?? "",
    name,
    fullName,
    description: firstString(value, ["description"]) ?? "",
    visibility: firstString(value, ["visibility"]) ?? "unknown",
    defaultBranch: firstString(value, ["default_branch"]) ?? "main",
    httpsUrl: firstString(value, ["clone_url", "http_url_to_repo", "html_url"]) ?? "",
    sshUrl: firstString(value, ["ssh_url", "ssh_url_to_repo"]) ?? undefined,
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
