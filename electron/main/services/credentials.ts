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
