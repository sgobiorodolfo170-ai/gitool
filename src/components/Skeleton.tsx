/**
 * 加载骨架（阶段 D3）。
 *
 * 只做静态灰块，不做 shimmer 动画：桌面工具的“加载中”应当是安静的，
 * 闪烁反而制造噪音；同时天然满足 prefers-reduced-motion。
 */
export function Skeleton({
  rows = 3,
  variant = "row",
}: {
  rows?: number;
  variant?: "row" | "card" | "panel";
}) {
  return (
    <div className={`skeleton skeleton-${variant}`} aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div className="skeleton-block" key={index} />
      ))}
    </div>
  );
}
