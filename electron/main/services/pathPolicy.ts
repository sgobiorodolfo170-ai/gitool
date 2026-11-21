import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { win32 } from "node:path";

/**
 * 路径准入策略（纯函数，零 electron / 数据库依赖）。
 *
 * why 独立成模块：路径类 IPC 的威胁不是「渲染层传错参数」，而是渲染层被攻破后
 * 直接构造任意路径。统一在这里做「本地绝对路径 + 允许根目录」两道校验，
 * 避免 12+ 个 handler 各写一份——历史上 assertDirectory 就是这样长出了三种不同实现。
 *
 * why 固定使用 path.win32 而不是宿主平台的 path：本产品只支持 Windows
 * （package.json 的 "Windows Git repository workspace"），固定 win32 语义可以让
 * 判断结果与宿主平台无关，单元测试也能在任意平台复现 C:\ 风格路径的边界。
 */

/** 允许根目录集合的组装参数。全部可选，便于调用方按通道裁剪放行面。 */
export interface AllowedRootOptions {
  /** 用户主目录；未提供时取 os.homedir()。 */
  readonly homeDirectory?: string;
  /** 已登记项目路径（调用方从 storage/projects 读取后传入，本模块不依赖数据库）。 */
  readonly registeredProjectPaths?: readonly string[];
  /** 备份目录（设置里的默认备份目录，或会话内选择的目录）。 */
  readonly backupDirectory?: string | null;
  /** 显式追加目录（例如本次 system:selectDirectory 的返回值）。 */
  readonly extraRoots?: readonly string[];
}

/**
 * 路径策略拒绝错误。
 *
 * why 单独类型：渲染层可按 code 把「策略拒绝」与「目录不存在」区分开；
 * 文案统一为中文，不含底层英文异常，可直接展示给用户。
 */
export class PathPolicyError extends Error {
  readonly code = "PATH_NOT_ALLOWED";

  constructor(message: string) {
    super(message);
    this.name = "PathPolicyError";
  }
}

/** UNC / 设备路径前缀：`\\server\share`、`//server/share`、`\\?\C:\...`、`\\.\...`。 */
const UNC_PREFIX_PATTERN = /^[\\/]{2}/;
/** 只接受「盘符 + 分隔符」形式的本机根，排除 `\foo`（无盘符）与 `C:foo`（驱动器相对）。 */
const DRIVE_ROOT_PATTERN = /^[A-Za-z]:[\\/]$/;
/** Windows 保留设备名（不区分大小写，带扩展名同样被系统解释为设备）。 */
const RESERVED_DEVICE_NAME_PATTERN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
/** 控制字符：NUL 会被 Win32 API 当作字符串截断点，其余控制字符也会污染日志与 spawn 参数。 */
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f]/;

/**
 * 断言目标是一个本机绝对路径，并返回规范化后的路径。
 *
 * 拒绝顺序即攻击面顺序：
 * 1. UNC 先于绝对路径判断——Win32 认为 `\\server\share` 是绝对路径，先放行就等于允许
 *    主进程替渲染层发起 SMB 出站认证，可能泄露 Net-NTLMv2 哈希；
 * 2. 相对路径与驱动器相对路径（`C:foo`）一律拒绝——它们依赖进程 cwd，结果不可预期；
 * 3. 任意 `..` 段直接拒绝——即使 resolve 后仍落在根内，也没有任何正常 IPC 会传这种路径，
 *    拒绝整类输入比逐一证明「穿越后仍安全」更可靠；
 * 4. 控制字符与保留设备名——两者都会让 Win32 把路径解释成与字面不同的对象。
 *
 * @returns `win32.resolve` 后的规范路径（去掉尾随分隔符，统一分隔符）。
 */
export function assertLocalAbsolutePath(target: string, label = "路径"): string {
  if (typeof target !== "string" || target.length === 0) {
    throw new PathPolicyError(`${label}不能为空`);
  }
  if (UNC_PREFIX_PATTERN.test(target)) {
    throw new PathPolicyError(`不支持网络共享路径（UNC）：${label}`);
  }
  if (CONTROL_CHARACTER_PATTERN.test(target)) {
    throw new PathPolicyError(`${label}包含非法控制字符`);
  }
  if (!win32.isAbsolute(target)) {
    throw new PathPolicyError(`${label}必须是绝对路径`);
  }
  const rawRoot = win32.parse(target).root;
  if (!DRIVE_ROOT_PATTERN.test(rawRoot)) {
    // 例：`\Windows\System32`（缺盘符）、`C:foo`（驱动器相对，isAbsolute 已拦）。
    throw new PathPolicyError(`${label}必须是本地盘符绝对路径`);
  }
  assertNoParentTraversal(target, label);
  assertNoReservedDeviceName(target, label);
  return win32.resolve(target);
}

/**
 * 断言目标位于任一允许根之下，并返回规范化后的路径。
 *
 * why 必须用 path.relative 而不是 startsWith：`C:\data-evil` 以 `C:\data` 开头，
 * 但它在语义上并不在 `C:\data` 目录内；relative 会得到 `..\data-evil`，
 * 据此判断才拦得住前缀式绕过。同时 relative 天然处理尾随分隔符与 `.` 段。
 *
 * 比较前统一 `toLowerCase()`：Windows 文件系统大小写不敏感，
 * `C:\DATA\Proj` 与 `c:\data\proj` 必须视为同一路径，不能因大小写差异误拒正常项目。
 *
 * 根目录来自设置 / 数据库 / 对话框，属于「可能被篡改但不应扩大放行面」的配置：
 * 非法根（UNC、相对、穿越）直接丢弃，而不是让整条通道失败。
 */
export function assertPathAllowed(
  target: string,
  roots: readonly string[],
  label = "路径",
): string {
  const resolvedTarget = assertLocalAbsolutePath(target, label);
  if (findContainingRoot(resolvedTarget, roots) !== null) {
    return resolvedTarget;
  }
  throw new PathPolicyError(`路径不在允许范围内：${label}`);
}

/**
 * 断言目标可以作为「已登记项目」写入数据库。
 *
 * why 需要它：projects 表是路径策略中「已登记项目路径」白名单的唯一来源。
 * 若不校验，被攻破的渲染层可以先 save 一条 path = C:\Windows\System32 的假项目，
 * 之后 A-11 的白名单就会亲手放行这个系统目录——白名单反而成了后门。
 *
 * 校验顺序：
 * 1. 复用本机绝对路径校验（UNC / 相对 / `..` / 设备名）；
 * 2. 必须是已存在的目录——下游 git / fs 操作都假设它是目录，登记一个不存在路径没有意义；
 * 3. 拒绝盘符根——登记 `C:\` 等于把整盘登记成项目；
 * 4. 拒绝系统关键目录及其子目录（SystemRoot / ProgramFiles / ProgramFiles(x86) / ProgramData）。
 *
 * ⚠ 边界说明：这是**纵深防御，不是强边界**。它挡得住「凭空登记系统目录」，
 * 挡不住「登记用户自己的任意目录」；真正的闭环需要「只允许 selectDirectory / clone /
 * init 产生的路径」，即引入路径来源凭证（provenance），属后续设计。
 */
export function assertRegistrableProjectPath(target: string, label = "项目路径"): string {
  const resolved = assertLocalAbsolutePath(target, label);
  if (win32.parse(resolved).root === resolved) {
    throw new PathPolicyError(`${label}不能是磁盘根目录`);
  }
  if (!existsSync(resolved)) {
    throw new PathPolicyError(`${label}不存在`);
  }
  let isDirectory: boolean;
  try {
    isDirectory = statSync(resolved).isDirectory();
  } catch {
    // existsSync 与 statSync 之间存在 TOCTOU 窗口，权限/竞态导致的失败按「无法访问」处理
    throw new PathPolicyError(`${label}无法访问`);
  }
  if (!isDirectory) {
    throw new PathPolicyError(`${label}不是目录`);
  }
  const criticalRoot = findContainingRoot(resolved, systemCriticalRoots());
  if (criticalRoot !== null) {
    throw new PathPolicyError(`${label}位于系统关键目录（${criticalRoot}）之下`);
  }
  return resolved;
}

/**
 * 计算本次保存中「需要重新做登记校验」的路径。
 *
 * why 需要差集而不是全量：projects:save 是整表覆盖保存，收藏、改别名、删除项目都会
 * 触发一次落库。若逐条校验所有已登记路径，任何一个离线盘（U 盘拔出、网络盘未挂载、
 * 目录被手工删除）都会让这些无关操作一起失败。只校验「本次新出现/被改过的路径」，
 * 既保住「凭空登记系统目录」的拦截，又不会用历史路径阻断正常操作。
 *
 * why 用路径而不是 id 做差集：项目换路径（移动/改指向）本质上是把一个新目录登记进
 * 白名单，必须重新校验；反之 id 变化但路径没变不会扩大放行面，无需校验。
 *
 * why 归一化：Windows 路径大小写不敏感，正/反斜杠与尾随分隔符可互换；不归一化会让
 * 「同一个目录」因写法不同被误判为新路径，进而触发无谓的磁盘检查。
 */
export function pathsNeedingValidation(
  incoming: readonly { path: string }[],
  existingPaths: ReadonlySet<string>,
): string[] {
  const existingKeys = new Set<string>();
  for (const existingPath of existingPaths) {
    existingKeys.add(normalizePathKey(existingPath));
  }

  const seen = new Set<string>();
  const pending: string[] = [];
  for (const item of incoming) {
    const key = normalizePathKey(item.path);
    if (existingKeys.has(key) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    pending.push(item.path);
  }
  return pending;
}

/**
 * 路径比较键：统一分隔符、去掉「非盘符根」的尾随分隔符、统一小写。
 *
 * why 不做 resolve：相对路径 / `..` 必须原样留在「新路径」里交给登记校验拒绝，
 * 不能先被进程 cwd 解析成某个已登记目录，从而跳过校验。
 */
function normalizePathKey(target: string): string {
  const unified = target.replace(/\//g, "\\");
  const withoutTrailing = /^[A-Za-z]:\\$/.test(unified) ? unified : unified.replace(/\\+$/, "");
  return withoutTrailing.toLowerCase();
}

/**
 * 组装允许根集合：用户主目录 + 已登记项目路径 + 备份目录 + 显式追加目录。
 *
 * why 由调用方传入项目路径：本模块保持纯函数才能被单测直接覆盖；storage/projects
 * 依赖数据库连接，直接 import 会让路径策略的单测必须启动 SQLite。
 *
 * why 去重（大小写不敏感）：多个来源常常指向同一目录（项目在用户主目录下、
 * 会话选择目录又恰好是备份目录），重复根只会让 relative 判断白跑几轮。
 */
export function collectAllowedRoots(options: AllowedRootOptions = {}): string[] {
  const candidates: string[] = [];
  const home = options.homeDirectory ?? homedir();
  if (home) {
    candidates.push(home);
  }
  if (options.registeredProjectPaths) {
    candidates.push(...options.registeredProjectPaths);
  }
  if (options.backupDirectory) {
    candidates.push(options.backupDirectory);
  }
  if (options.extraRoots) {
    candidates.push(...options.extraRoots);
  }

  const roots: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const canonical = canonicalizeRoot(candidate);
    if (canonical === null) {
      continue;
    }
    const key = canonical.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    roots.push(canonical);
  }
  return roots;
}

/**
 * 备份类通道的允许根参数。
 *
 * why 与 AllowedRootOptions 分开：备份的「目标/归档」和「项目路径」不是同一个信任面。
 * 备份产物没有理由写进任意已登记项目目录，因此这里刻意不接收 registeredProjectPaths，
 * 只允许用户主目录、设置里的默认备份目录，以及本次会话在系统对话框里选过的目录。
 */
export interface BackupPathOptions {
  /** 用户主目录；未提供时取 os.homedir()。 */
  readonly homeDirectory?: string;
  /** 设置里的默认备份目录；非法值会被 canonicalizeRoot 丢弃。 */
  readonly backupDirectory?: string | null;
  /** 会话内由 system:selectDirectory 选出的目录。 */
  readonly extraRoots?: readonly string[];
}

/**
 * 组装备份类通道的允许根：用户主目录 + 默认备份目录 + 会话选择目录。
 *
 * why 不并入 collectAllowedRoots 的默认全集：collectAllowedRoots 是「项目路径」的
 * 组合器，把已登记项目也当作根；备份目标若沿用它会扩大放行面（渲染层可先登记一个
 * 假项目，再把备份写进该项目目录）。这里用独立入口把「哪些来源可以作为备份根」
 * 写死在代码里，调用方只能传值、不能改语义。
 */
export function backupPathRoots(options: BackupPathOptions = {}): string[] {
  return collectAllowedRoots({
    homeDirectory: options.homeDirectory,
    backupDirectory: options.backupDirectory,
    extraRoots: options.extraRoots,
  });
}

/**
 * 断言 target 可以作为备份目录 / 备份归档路径，并返回规范化后的路径。
 *
 * why 需要独立于 assertPathAllowed：备份目标不应是系统目录。即使有人把
 * settings.defaultBackupDirectory 改成 `C:\Windows\System32`（settings:save 目前没有
 * 路径语义校验），也不能让备份通道亲手把 zip 写进去——所以系统关键目录在「命中
 * 允许根」之前就被显式拒绝，不能指望白名单天然覆盖不到它。
 *
 * 校验顺序（越靠前越先拒绝）：
 * 1. 本机绝对路径语义（UNC / 相对 / `..` / 控制字符 / 保留设备名）；
 * 2. 盘符根（`C:\`）——备份落到整盘根等于把残留文件撒到系统盘；
 * 3. 系统关键目录（SystemRoot / ProgramFiles / ProgramData）及其子目录；
 * 4. 允许根（主目录 + 默认备份目录 + 会话选择目录）。
 */
export function requireAllowedBackupPath(
  target: string,
  options: BackupPathOptions = {},
  label = "备份路径",
): string {
  const resolved = assertLocalAbsolutePath(target, label);
  if (win32.parse(resolved).root === resolved) {
    throw new PathPolicyError(`${label}不能是磁盘根目录`);
  }
  const criticalRoot = findContainingRoot(resolved, systemCriticalRoots());
  if (criticalRoot !== null) {
    throw new PathPolicyError(`${label}位于系统关键目录（${criticalRoot}）之下`);
  }
  if (findContainingRoot(resolved, backupPathRoots(options)) === null) {
    throw new PathPolicyError(`${label}不在允许范围内`);
  }
  return resolved;
}

/** 拒绝路径中出现 `..` 段（`...`、`..cache` 是合法文件名，不能误伤）。 */
function assertNoParentTraversal(target: string, label: string): void {
  if (target.split(/[\\/]+/).includes("..")) {
    throw new PathPolicyError(`${label}不能包含上级目录（..）`);
  }
}

/**
 * 拒绝 Windows 保留设备名：`C:\temp\CON`、`C:\temp\nul.txt` 都会被系统解释为设备。
 * Windows 还会忽略名字末尾的空格与点，因此先裁掉再比较。
 */
function assertNoReservedDeviceName(target: string, label: string): void {
  for (const segment of target.split(/[\\/]+/)) {
    const baseName = segment.split(".")[0].replace(/[ .]+$/, "");
    if (baseName.length > 0 && RESERVED_DEVICE_NAME_PATTERN.test(baseName)) {
      throw new PathPolicyError(`${label}包含 Windows 保留设备名`);
    }
  }
}

/** 规范化单个根目录；非法根返回 null（丢弃而不是抛错，避免一条坏配置废掉整条通道）。 */
function canonicalizeRoot(root: string): string | null {
  if (typeof root !== "string" || root.trim().length === 0) {
    return null;
  }
  try {
    return assertLocalAbsolutePath(root, "允许目录");
  } catch {
    return null;
  }
}

/**
 * 找出包含 target（已 resolve）的第一个根，未命中返回 null。
 *
 * why 与 assertPathAllowed 共用同一套 relative 判断：白名单放行与系统目录拒绝
 * 必须是同一种包含语义，否则会出现「放行能过、拒绝漏过」的不对称边界。
 */
function findContainingRoot(target: string, roots: readonly string[]): string | null {
  const targetKey = target.toLowerCase();
  for (const root of roots) {
    const canonicalRoot = canonicalizeRoot(root);
    if (canonicalRoot !== null && isWithinRoot(canonicalRoot, targetKey)) {
      return canonicalRoot;
    }
  }
  return null;
}

/**
 * 系统关键目录（只纳入当前环境真实配置的项）。
 * why 同时接受 SystemRoot 与 windir：极少数精简镜像只设置其中一个；
 * 缺失/空值项直接跳过，不能让环境变量缺失把校验变成空转。
 */
function systemCriticalRoots(): string[] {
  return [
    process.env.SystemRoot,
    process.env.windir,
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
    process.env.ProgramData,
  ].filter((root): root is string => typeof root === "string" && root.length > 0);
}

/**
 * 判断 targetKey（已转小写）是否在 root 之内。
 *
 * relative 返回值三种合法形态：
 * - `""`：与根完全相同；
 * - 普通相对路径（可能以 `..cache` 开头）：在根内，必须以「`..` + 分隔符」为界判断；
 * - `..` 或 `..\...` 或绝对路径：在根外。
 */
function isWithinRoot(root: string, targetKey: string): boolean {
  const relativePath = win32.relative(root.toLowerCase(), targetKey);
  if (relativePath === "") {
    return true;
  }
  return (
    relativePath !== ".." &&
    !relativePath.startsWith(`..${win32.sep}`) &&
    !win32.isAbsolute(relativePath)
  );
}
