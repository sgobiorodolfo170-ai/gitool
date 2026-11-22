import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, PenLine, Plus, Trash2 } from "lucide-react";
import type { WorkspaceEntity } from "../types";

/**
 * 工作区切换器（阶段 E2 起为 WAI-ARIA menu 模式）。
 *
 * 结构要点：外层 div 只负责定位与「点击外部关闭」，可交互的触发区是
 * 独立 button（aria-haspopup/aria-expanded），菜单是它的兄弟节点——
 * 不能把菜单塞进 button 里（交互内容嵌套非法，读屏与键盘都会错乱）。
 *
 * 键盘：Enter/Space/ArrowDown 打开并聚焦首项，↑↓ 循环，Home/End 跳首尾，
 * Escape 关闭并把焦点还给触发按钮。
 */
export function WorkspaceSwitcher({
  workspaces,
  activeId,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
}: {
  workspaces: WorkspaceEntity[];
  activeId: string;
  onSwitch: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (workspace: WorkspaceEntity) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"idle" | "create" | "rename">("idle");
  const [renaming, setRenaming] = useState<WorkspaceEntity | null>(null);
  const [draft, setDraft] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const active = workspaces.find((item) => item.id === activeId);
  // 头像取工作区名称首字符（阶段 D8）：原实现硬编码「L」，是无效的身份占位。
  // 用 Array.from 按码点取首字，避免 emoji/代理对只显示半个字符。
  const initial = Array.from((active?.name ?? "工作区").trim())[0]?.toUpperCase() ?? "W";

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
  }, []);

  // 打开后焦点落位：菜单模式落第一项，编辑模式落输入框。
  useEffect(() => {
    if (!open) return;
    if (mode === "idle") {
      menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    } else {
      inputRef.current?.focus();
    }
  }, [open, mode]);

  const startCreate = () => {
    setMode("create");
    setRenaming(null);
    setDraft("");
  };

  const startRename = (workspace: WorkspaceEntity) => {
    setMode("rename");
    setRenaming(workspace);
    setDraft(workspace.name);
  };

  const cancelEdit = () => {
    setMode("idle");
    setRenaming(null);
    setDraft("");
  };

  const close = () => {
    setOpen(false);
    cancelEdit();
  };

  const commit = () => {
    const name = draft.trim();
    if (!name) return;
    if (mode === "create") {
      onCreate(name);
    } else if (mode === "rename" && renaming && name !== renaming.name) {
      onRename(renaming.id, name);
    }
    cancelEdit();
  };

  const onTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      close();
      return;
    }
    if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      setOpen(true);
    }
  };

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      triggerRef.current?.focus();
      return;
    }
    // 编辑模式下焦点在表单里，方向键属于输入控件，不做菜单导航。
    if (mode !== "idle") return;

    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    switch (event.key) {
      case "ArrowDown":
        next = index < 0 ? 0 : (index + 1) % items.length;
        break;
      case "ArrowUp":
        next = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = items.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    // P-35：next 为 -1 时表示没有可聚焦项（全部禁用），跳过聚焦而非越界。
    items[next]?.focus();
  };

  return (
    <div className="workspace-switcher" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="workspace-switcher-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="workspace-avatar" aria-hidden="true">
          {initial}
        </span>
        <span className="workspace-copy">
          <span>{active?.name ?? "工作区"}</span>
          <small>本地模式</small>
        </span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open && (
        <div
          className="workspace-menu"
          ref={menuRef}
          role={mode === "idle" ? "menu" : undefined}
          aria-label={mode === "idle" ? "工作区" : undefined}
          onKeyDown={onMenuKeyDown}
        >
          {mode === "idle" ? (
            <>
              <div className="workspace-menu-header">工作区</div>
              {workspaces.map((item) => (
                <button
                  type="button"
                  role="menuitem"
                  className={`workspace-menu-item ${item.id === activeId ? "active" : ""}`}
                  key={item.id}
                  onClick={() => {
                    close();
                    onSwitch(item.id);
                  }}
                >
                  <span>{item.name}</span>
                  {item.id === activeId && <Check size={14} aria-hidden="true" />}
                </button>
              ))}
              <div className="workspace-menu-divider" />
              <button
                type="button"
                role="menuitem"
                className="workspace-menu-item action"
                onClick={startCreate}
              >
                <Plus size={14} aria-hidden="true" />
                新建工作区
              </button>
              {active && (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    className="workspace-menu-item action"
                    onClick={() => startRename(active)}
                  >
                    <PenLine size={14} aria-hidden="true" />
                    重命名
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="workspace-menu-item action danger"
                    onClick={() => {
                      close();
                      onDelete(active);
                    }}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    删除工作区
                  </button>
                </>
              )}
            </>
          ) : (
            <form
              className="workspace-menu-form"
              onSubmit={(event) => {
                event.preventDefault();
                commit();
              }}
            >
              <input
                ref={inputRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={mode === "create" ? "工作区名称" : "重命名工作区"}
                aria-label={mode === "create" ? "工作区名称" : "重命名工作区"}
              />
              <div className="workspace-menu-form-actions">
                <button type="button" onClick={cancelEdit}>
                  取消
                </button>
                <button type="submit" disabled={!draft.trim()}>
                  {mode === "create" ? "创建" : "保存"}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
