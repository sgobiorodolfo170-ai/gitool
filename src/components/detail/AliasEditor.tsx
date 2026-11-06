import { useState } from "react";
import { Check, PenLine } from "lucide-react";

/** 项目别名的行内编辑徽标：点击展开输入框，Enter 保存 / Esc 取消。原 ProjectDetail 内嵌组件原样迁移。 */
export function AliasEditor({
  alias,
  onSave,
}: {
  alias?: string;
  onSave: (alias: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(alias ?? "");
  if (!editing) {
    return (
      <button
        className="alias-badge"
        onClick={() => {
          setValue(alias ?? "");
          setEditing(true);
        }}
        title="编辑别名"
      >
        {alias ? (
          <>
            <PenLine size={11} />
            {alias}
          </>
        ) : (
          <span className="alias-empty">别名</span>
        )}
      </button>
    );
  }
  return (
    <div className="alias-edit">
      <input
        autoFocus
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            onSave(value);
            setEditing(false);
          }
          if (event.key === "Escape") {
            setEditing(false);
          }
        }}
        placeholder="输入别名"
      />
      <button
        className="bare-button"
        onClick={() => {
          onSave(value);
          setEditing(false);
        }}
      >
        <Check size={14} />
      </button>
    </div>
  );
}
