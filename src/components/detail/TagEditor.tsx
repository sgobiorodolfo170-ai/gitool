import { useState } from "react";
import { Check, Plus } from "lucide-react";

/** 项目标签的「+」添加入口：展开输入新标签，去重后回调。原 ProjectDetail 内嵌组件原样迁移。 */
export function TagEditor({ tags, onAdd }: { tags: string[]; onAdd: (tag: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const submit = () => {
    const tag = value.trim();
    if (tag && !tags.includes(tag)) {
      onAdd(tag);
    }
    setValue("");
    setEditing(false);
  };
  if (!editing) {
    return (
      <button
        className="add-tag"
        aria-label="添加标签"
        title="添加标签"
        onClick={() => setEditing(true)}
      >
        <Plus size={13} />
      </button>
    );
  }
  return (
    <div className="tag-edit">
      <input
        autoFocus
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") submit();
          if (event.key === "Escape") setEditing(false);
        }}
        placeholder="新标签"
      />
      <button className="bare-button" onClick={submit}>
        <Check size={13} />
      </button>
    </div>
  );
}
