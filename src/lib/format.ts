import type { Project } from "../../shared/types";

/**
 * 人类可读的文件大小。
 * 只做到 MB：桌面工具里项目体积超过 1GB 时，显示 "1.2 GB" 与 "1234.5 MB"
 * 的信息量差别不大，少一个分支更不容易出错。
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "0 B";
  }
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * 判断项目是否「沉睡」（超过 N 个月没有提交）。
 *
 * 只取 updatedAt 的日期部分再构造本地零点，避免时区差异把「刚好 3 个月」
 * 算成 2 个月 30 天。解析失败时返回 false——宁可漏报，也不要把正常项目标成沉睡。
 */
export function isDormant(project: Project, thresholdMonths = 3): boolean {
  const match = project.updatedAt.match(/^\d{4}-\d{2}-\d{2}/);
  if (!match) {
    return false;
  }
  const lastActivity = new Date(`${match[0]}T00:00:00`);
  if (Number.isNaN(lastActivity.getTime())) {
    return false;
  }
  const monthsAgo = new Date();
  monthsAgo.setMonth(monthsAgo.getMonth() - thresholdMonths);
  return lastActivity < monthsAgo;
}

/** 提交时间：`2026/10/26 19:30`。日期非法时原样返回，不抛错。 */
export function formatCommitDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 提交历史的分组标题：今天 / 2026年10月26日。 */
export function formatDayGroup(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return "今天";
  }
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
}
