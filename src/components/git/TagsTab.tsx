import { useEffect, useState } from "react";
import type { DesktopBridge } from "../../../shared/types";
import type { GitTag } from "../../types";
import { useLoadSequence } from "./loadSequence";

/**
 * 「标签」tab：标签列表（删除）与新建标签。
 * 数据（标签列表、新建表单）与 loading 归本组件自持；
 * busy/output/全局互斥由面板下发（见 GitActionsPanel 头注释）。
 */
export function TagsTab({
  projectPath,
  bridge,
  active,
  refreshSeq,
  isBusy,
  setBusy,
  setOutput,
  onLoadingChange,
  onCountChange,
}: {
  projectPath: string;
  bridge: DesktopBridge | undefined;
  /** 是否为当前激活 tab：非激活时保持挂载、以 hidden 隐藏（沿用 ProjectDetail 的 visitedTabs 范式） */
  active: boolean;
  /** 面板刷新按钮的递增序号：变化且处于激活态时重载本 tab 数据 */
  refreshSeq: number;
  /** Git 操作全局互斥（本面板 busy 或批量操作 externalBusy）：禁用全部写操作按钮 */
  isBusy: boolean;
  setBusy: (busy: boolean) => void;
  setOutput: (output: string) => void;
  /** loading 变化上报面板：驱动头部刷新按钮旋转态 */
  onLoadingChange: (loading: boolean) => void;
  /** 标签数上报面板：驱动「标签」tab 角标 */
  onCountChange: (count: number) => void;
}) {
  const [tags, setTags] = useState<GitTag[]>([]);
  const [newTagName, setNewTagName] = useState("");
  const [newTagMessage, setNewTagMessage] = useState("");
  const [loading, setLoadingState] = useState(false);
  const { beginLoad, isStaleLoad } = useLoadSequence();

  // loading 本地驱动本 tab 空态文案，同时上报面板驱动头部刷新按钮旋转态
  const setLoading = (value: boolean) => {
    setLoadingState(value);
    onLoadingChange(value);
  };

  const loadTags = async () => {
    if (!bridge) return;
    const seq = beginLoad("tags");
    setLoading(true);
    try {
      const list = await bridge.listTags(projectPath);
      if (isStaleLoad("tags", seq)) return;
      setTags(list);
      onCountChange(list.length);
    } catch {
      if (isStaleLoad("tags", seq)) return;
      setTags([]);
      onCountChange(0);
    } finally {
      if (!isStaleLoad("tags", seq)) setLoading(false);
    }
  };

  // 换项目时只清数据；新建表单输入沿用原面板行为，不随项目切换清空
  useEffect(() => {
    setTags([]);
    onCountChange(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath]);

  // 激活 / 换项目 / 点刷新时重载（等价原面板 refreshActive 的 tags 分支）
  useEffect(() => {
    if (active) void loadTags();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, projectPath, refreshSeq]);

  const addTag = async () => {
    if (!bridge || !newTagName.trim()) return;
    setBusy(true);
    try {
      await bridge.createTag({
        path: projectPath,
        name: newTagName.trim(),
        message: newTagMessage.trim() || undefined,
      });
      setOutput(`标签 ${newTagName.trim()} 已创建`);
      setNewTagName("");
      setNewTagMessage("");
      await loadTags();
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "创建标签失败");
    } finally {
      setBusy(false);
    }
  };

  const removeTag = async (name: string) => {
    if (!bridge) return;
    if (!window.confirm(`删除标签 ${name}？`)) return;
    setBusy(true);
    try {
      await bridge.deleteTag(projectPath, name);
      setOutput(`标签 ${name} 已删除`);
      await loadTags();
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "删除标签失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="git-tab-content" hidden={!active}>
      {tags.length === 0 ? (
        <div className="git-empty">{loading ? "正在读取标签..." : "还没有标签"}</div>
      ) : (
        <div className="tag-list">
          {tags.map((tag) => (
            <div className="tag-row" key={tag.name}>
              <div className="tag-main">
                <strong>{tag.name}</strong>
                <small>
                  {tag.shortCommit}
                  {tag.message ? ` · ${tag.message}` : ""}
                </small>
              </div>
              <button
                className="bare-button danger"
                onClick={() => removeTag(tag.name)}
                disabled={isBusy}
              >
                删除
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="tag-create">
        <input
          value={newTagName}
          onChange={(event) => setNewTagName(event.target.value)}
          placeholder="标签名称（如 v0.1.0）"
        />
        <input
          value={newTagMessage}
          onChange={(event) => setNewTagMessage(event.target.value)}
          placeholder="标签说明（可选）"
        />
        <button
          className="button secondary compact-button"
          onClick={addTag}
          disabled={isBusy || !newTagName.trim()}
        >
          创建
        </button>
      </div>
    </div>
  );
}
