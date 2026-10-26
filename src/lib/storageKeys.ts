/**
 * localStorage 键名集中管理。
 *
 * 这些键只存 UI 偏好（上次导入目录、活动工作区、首启引导是否已关闭），
 * 真正的业务数据在 SQLite 里。集中定义避免键名散落在组件里被改错——
 * 改错键名不会报错，只会静默丢失用户偏好。
 */
export const LAST_IMPORT_DIRECTORY_KEY = "gitool.lastImportDirectory";
export const ACTIVE_WORKSPACE_KEY = "gitool.activeWorkspace";
export const SETUP_DISMISS_KEY = "gitool.setup.dismissed";
