import { Entry } from "@napi-rs/keyring";

const SERVICE_NAME = "com.gitool.desktop";

export function saveCredential(credentialRef: string, secret: string): void {
  try {
    const entry = new Entry(SERVICE_NAME, credentialRef);
    entry.setPassword(secret);
  } catch (error) {
    throw new Error(`无法保存令牌到 Windows 凭据管理器：${errorMessage(error)}`);
  }
}

export function readCredential(credentialRef: string): string {
  try {
    const entry = new Entry(SERVICE_NAME, credentialRef);
    const password = entry.getPassword();
    if (password === null) {
      throw new Error("凭据不存在");
    }
    return password;
  } catch (error) {
    throw new Error(`无法读取令牌，请重新录入：${errorMessage(error)}`);
  }
}

export function deleteCredential(credentialRef: string): void {
  try {
    const entry = new Entry(SERVICE_NAME, credentialRef);
    entry.deletePassword();
  } catch {
    // 凭据不存在时视为已删除
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// 探测 Windows 凭据管理器可写：写入一个随机探针条目再删除，失败则视为不可用。
// 设计理由：组策略或安全软件可能禁用凭据管理器，PAT 与 AI Key 将无法保存，
// 体检时主动暴露该风险让小白用户提前知情，而不是等到保存令牌时才报错。
export function probeKeyring(): boolean {
  try {
    const ref = `probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const entry = new Entry(SERVICE_NAME, ref);
    entry.setPassword("probe");
    entry.deletePassword();
    return true;
  } catch {
    return false;
  }
}
