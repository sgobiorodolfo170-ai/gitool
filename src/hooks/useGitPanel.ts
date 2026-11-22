import { useCallback, useEffect, useReducer } from "react";
import type {
  BranchInfo,
  ChangeFile,
  CommitEntry,
  CommitRequest,
  CommitResult,
  CreateBranchInput,
  CreateTagInput,
  DeleteBranchInput,
  GitOperation,
  GitOperationResult,
  GitSnapshot,
  GitTag,
  RevertCommitInput,
  SwitchBranchInput,
} from "../types";
import { getDesktopBridge } from "../lib/bridge";

/**
 * Git 面板单一状态源（P-16 / 架构评审 L-11 + L-13）。
 *
 * why 收敛到一个 store：原先「当前 tab / shared output / busy / 计数 / reload」
 * 散落在 4 个 tab 组件的 11 个 props + 4 个 setter + ref 登记式联动里，
 * busy 更是存在 3 个状态源（模块级 ref / hook state / 面板 state），
 * 「批量操作中仍可提交」的历史缺陷正是透传链断裂的结果。
 * useReducer 单一 store 后：tab 只读状态、只发 action，互斥由机制保证。
 */

interface GitPanelState {
  activeTab: "changes" | "branches" | "history" | "tags";
  busy: boolean;
  output: string | null;
  snapshot: GitSnapshot | null;
  /** 显式重载令牌：替代 ref 登记式跨 tab 联动，tab 用 key/依赖监听它。 */
  reloadToken: number;
}

type GitPanelAction =
  | { type: "SET_TAB"; tab: GitPanelState["activeTab"] }
  | { type: "SET_BUSY"; busy: boolean }
  | { type: "SET_OUTPUT"; output: string | null }
  | { type: "SET_SNAPSHOT"; snapshot: GitSnapshot | null }
  | { type: "RELOAD" };

function reducer(state: GitPanelState, action: GitPanelAction): GitPanelState {
  switch (action.type) {
    case "SET_TAB":
      return { ...state, activeTab: action.tab };
    case "SET_BUSY":
      return { ...state, busy: action.busy };
    case "SET_OUTPUT":
      return { ...state, output: action.output };
    case "SET_SNAPSHOT":
      return { ...state, snapshot: action.snapshot };
    case "RELOAD":
      return { ...state, reloadToken: state.reloadToken + 1 };
    default:
      return state;
  }
}

export interface UseGitPanelResult {
  activeTab: GitPanelState["activeTab"];
  busy: boolean;
  output: string | null;
  snapshot: GitSnapshot | null;
  reloadToken: number;
  setTab: (tab: GitPanelState["activeTab"]) => void;
  reload: () => void;
  /** 同步类 Git 操作（fetch/pull/push/sync/revert）：busy 互斥由本 hook 保证。 */
  runOperation: (operation: GitOperation) => Promise<GitOperationResult | null>;
}

export function useGitPanel(projectPath: string): UseGitPanelResult {
  const bridge = getDesktopBridge();
  const [state, dispatch] = useReducer(reducer, {
    activeTab: "changes",
    busy: false,
    output: null,
    snapshot: null,
    reloadToken: 0,
  });

  const setTab = useCallback((tab: GitPanelState["activeTab"]) => {
    dispatch({ type: "SET_TAB", tab });
  }, []);

  const reload = useCallback(() => {
    dispatch({ type: "RELOAD" });
  }, []);

  const runOperation = useCallback(
    async (operation: GitOperation): Promise<GitOperationResult | null> => {
      if (!bridge || !projectPath) return null;
      dispatch({ type: "SET_BUSY", busy: true });
      try {
        const result = await bridge.runGitOperation(projectPath, operation);
        dispatch({ type: "SET_OUTPUT", output: result.output });
        dispatch({ type: "RELOAD" });
        return result;
      } catch (error) {
        dispatch({
          type: "SET_OUTPUT",
          output: error instanceof Error ? error.message : "操作失败",
        });
        return null;
      } finally {
        dispatch({ type: "SET_BUSY", busy: false });
      }
    },
    [bridge, projectPath],
  );

  // 项目路径变化时重取快照（替代各 tab 各自的 useEffect 拉取）。
  useEffect(() => {
    if (!bridge || !projectPath) return;
    let cancelled = false;
    void bridge
      .getProjectSnapshot(projectPath)
      .then((snapshot) => {
        if (!cancelled) dispatch({ type: "SET_SNAPSHOT", snapshot });
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: "SET_SNAPSHOT", snapshot: null });
      });
    return () => {
      cancelled = true;
    };
  }, [bridge, projectPath]);

  return { ...state, setTab, reload, runOperation };
}

/**
 * Git 域动作集合（P-01 收尾）：把 4 个 tab + GitActionsPanel 的 19 处桥直调
 * 收进一个 hook。所有写操作完成后调用 onDone（触发面板 reload），
 * busy 互斥统一交给 useGitPanel，动作层不再各自维护状态源。
 */
export function useGitPanelActions(
  projectPath: string,
  onDone: () => void = () => {},
) {
  const bridge = getDesktopBridge();

  const wrap = async <T>(task: () => Promise<T>): Promise<T | null> => {
    if (!bridge || !projectPath) return null;
    try {
      const result = await task();
      onDone();
      return result;
    } catch (error) {
      throw error;
    }
  };

  return {
    listChangedFiles: (): Promise<ChangeFile[]> =>
      bridge ? bridge.listChangedFiles(projectPath) : Promise.resolve([]),
    stageFiles: async (files: string[]): Promise<void> => {
      if (!bridge || !projectPath) return;
      await bridge.stageFiles(projectPath, files);
      onDone();
    },
    unstageFiles: async (files: string[]): Promise<void> => {
      if (!bridge || !projectPath) return;
      await bridge.unstageFiles(projectPath, files);
      onDone();
    },
    commitChanges: (input: Omit<CommitRequest, "path">): Promise<CommitResult | null> =>
      wrap(() => bridge!.commitChanges({ ...input, path: projectPath })),
    listBranches: (): Promise<BranchInfo[]> =>
      bridge ? bridge.listBranches(projectPath) : Promise.resolve([]),
    createBranch: (input: Omit<CreateBranchInput, "path">): Promise<void | null> =>
      wrap(() => bridge!.createBranch({ ...input, path: projectPath })),
    switchBranch: (input: Omit<SwitchBranchInput, "path">): Promise<void | null> =>
      wrap(() => bridge!.switchBranch({ ...input, path: projectPath })),
    deleteBranch: (input: Omit<DeleteBranchInput, "path">): Promise<void | null> =>
      wrap(() => bridge!.deleteBranch({ ...input, path: projectPath })),
    listHistory: (): Promise<CommitEntry[]> =>
      bridge ? bridge.listCommitHistory(projectPath) : Promise.resolve([]),
    revertCommit: (input: Omit<RevertCommitInput, "path">): Promise<GitOperationResult | null> =>
      wrap(() => bridge!.revertCommit({ ...input, path: projectPath })),
    listTags: (): Promise<GitTag[]> =>
      bridge ? bridge.listTags(projectPath) : Promise.resolve([]),
    createTag: (input: Omit<CreateTagInput, "path">): Promise<void | null> =>
      wrap(() => bridge!.createTag({ ...input, path: projectPath })),
    deleteTag: (name: string): Promise<void | null> =>
      wrap(() => bridge!.deleteTag(projectPath, name)),
  };
}
