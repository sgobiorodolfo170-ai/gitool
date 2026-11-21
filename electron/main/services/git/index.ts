/**
 * git 域聚合出口。
 *
 * why 显式逐符号重导出、不用 `export *`：本目录内 core/status 等模块额外导出了仅供
 * 子域协作使用的内部符号（runGit / runGitProcess / MAX_BUFFER / registerProcessStopper…），
 * `export *` 会把它们一并暴露成对外 API。
 *
 * 公开面口径（实测 64 个）：31 个业务符号 + 33 个测试护栏符号。
 * - 31 个业务符号 = 拆分前 git.ts 已公开的导出，逐一显式重导出，均未改名；
 * - 33 个测试护栏符号 = 31 个参数拼装函数（buildXxxArgs / buildOperationCommands）
 *   + chunkFilesForGitArgs + GIT_ARG_CHUNK。它们仅因 gitArgs.test.ts 需要对参数数组
 *   逐元素断言（toEqual 全数组）而导出，不属业务 API。
 * 因此相对拆分前是「业务符号零改名、零删除」，但确实存在 +33 个护栏符号的 API 面扩张
 * （非业务 API），不能表述为「零扩张」。
 *
 * ipc.ts / environment.ts / git.test.ts / gitArgs.test.ts 的 `from ".../services/git"`
 * 路径与符号集合保持不变（零行为变更）。
 */

export { getActiveGitBinary } from "./binary";
export {
  buildCredentialEnv,
  buildCurrentBranchArgs,
  buildGitCwdArgs,
  chunkFilesForGitArgs,
  GIT_ARG_CHUNK,
  redactGitOutput,
} from "./core";
export {
  buildInitArgs,
  buildRemoteAddArgs,
  buildRemoteListArgs,
  buildRemoteSetUrlArgs,
  initRepository,
  inspectLocalProject,
  moveProject,
  scanDirectoryForRepositories,
  setRemoteUrl,
} from "./repo";
export {
  buildCommitArgs,
  buildFileDiffArgs,
  buildLastCommitDateArgs,
  buildShortHeadArgs,
  buildStageArgs,
  buildStatusBranchArgs,
  buildStatusPorcelainZArgs,
  buildUnstageArgs,
  buildUntrackedFilesArgs,
  commitChanges,
  getFileDiff,
  getProjectSnapshot,
  listChangedFiles,
  stageFiles,
  unstageFiles,
} from "./status";
export {
  buildFetchArgs,
  buildOperationCommands,
  buildPullArgs,
  buildPushArgs,
  runGitOperation,
} from "./operation";
export {
  buildCreateTagArgs,
  buildDeleteTagArgs,
  buildListTagsArgs,
  createTag,
  deleteTag,
  listTags,
} from "./tags";
export { buildDiffNumstatArgs, buildDiffStatArgs, compareVersions } from "./compare";
export {
  buildBranchListArgs,
  buildCreateBranchArgs,
  buildDeleteBranchArgs,
  buildSwitchBranchArgs,
  createBranch,
  deleteBranch,
  listBranches,
  switchBranch,
} from "./branch";
export {
  buildCommitHistoryArgs,
  buildRevertArgs,
  listCommitHistory,
  listVersions,
  revertCommit,
} from "./history";
export { assertNoCredentialInUrl, buildCloneArgs, cloneRepository } from "./clone";
export { getDiskSize, invalidateDiskSizeCache, readProjectReadme } from "./disk";
