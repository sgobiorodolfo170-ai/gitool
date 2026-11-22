/**
 * 运行时常量单一来源（P-29 / 架构评审 L-16）。
 *
 * why 需要本文件：`RemoteProvider` 等联合类型原先在契约（types.ts 手写联合）、
 * 校验（schemas.ts 的 z.enum 字面量数组）、渲染（组件内手写联合）三处各写一遍，
 * 没有任何编译期关联。增删平台（如加 coding）时编译器只报「部分位置」，
 * 漏改处被 `.catch()` / `as` 静默吸收。
 *
 * 现在的派生链（单一事实源 → 类型 → 校验，方向不可逆）：
 *   const REMOTE_PROVIDERS = [...] as const
 *     → type RemoteProvider = (typeof REMOTE_PROVIDERS)[number]   （types.ts）
 *     → z.enum(REMOTE_PROVIDERS)                                  （schemas.ts 经 as const 断言）
 *
 * why 放独立文件而不并入 types.ts：types.ts 是纯类型叶（零运行时代码），
 * 本文件是运行时值；混入会让任何只引用类型的模块被迫把这段代码拖进产物。
 * （与 entities.ts / channels.ts / workspaceRules.ts 同一理由。）
 */

/** 远程平台枚举：类型（RemoteProvider）与 zod schema 都从这里派生。 */
export const REMOTE_PROVIDERS = ["github", "gitee", "gitlab"] as const;

/** 项目平台 = 远程平台 + 本地项目。 */
export const PROJECT_PROVIDERS = ["local", "github", "gitee", "gitlab"] as const;

/**
 * 远程仓库可见性：schema 与渲染层筛选共用。
 * `internal` 仅 GitLab 存在，GitHub/Gitee 的表单允许留空（""）。
 */
export const REPOSITORY_VISIBILITIES = ["public", "private", "internal", ""] as const;

/**
 * 支持搜索的平台：当前搜索 API 只覆盖 GitHub 与 Gitee（GitLab 的
 * 项目搜索端点形态不同），与「可添加账号的平台」是有意不同的集合。
 */
export const SEARCHABLE_PROVIDERS = ["github", "gitee"] as const;
