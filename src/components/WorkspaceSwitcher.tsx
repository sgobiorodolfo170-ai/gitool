import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, PenLine, Plus, Trash2 } from "lucide-react";
import type { WorkspaceEntity } from "../types";

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
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const active = workspaces.find((item) => item.id === activeId);

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
  }, []);

  useEffect(() => {
    if (open && mode !== "idle") {
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

  return (
    <div className="workspace-switcher" ref={ref} onClick={() => setOpen((current) => !current)}>
      <div className="workspace-avatar">L</div>
      <div className="workspace-copy">
        <span>{active?.name ?? "工作区"}</span>
        <small>本地模式</small>
      </div>
      <ChevronDown size={15} />
      {open && (
        <div className="workspace-menu" onClick={(event) => event.stopPropagation()}>
          {mode === "idle" ? (
            <>
              <div className="workspace-menu-header">工作区</div>
              {workspaces.map((item) => (
                <button
                  className={`workspace-menu-item ${item.id === activeId ? "active" : ""}`}
                  key={item.id}
                  onClick={() => {
                    setOpen(false);
                    onSwitch(item.id);
                  }}
                >
                  <span>{item.name}</span>
                  {item.id === activeId && <Check size={14} />}
                </button>
              ))}
              <div className="workspace-menu-divider" />
              <button className="workspace-menu-item action" onClick={startCreate}>
                <Plus size={14} />
                新建工作区
              </button>
              {active && (
                <>
                  <button
                    className="workspace-menu-item action"
                    onClick={() => startRename(active)}
                  >
                    <PenLine size={14} />
                    重命名
                  </button>
                  <button
                    className="workspace-menu-item action danger"
                    onClick={() => {
                      setOpen(false);
                      onDelete(active);
                    }}
                  >
                    <Trash2 size={14} />
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
