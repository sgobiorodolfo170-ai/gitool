import { useRef } from "react";

/**
 * 每类数据的加载序号守卫：快速切 tab / 连点文件时，慢的旧请求后返回
 * 不得覆盖新数据、不得抢走 loading 状态（2026-11-07 审查 P1-8）。
 *
 * 原 GitActionsPanel 的面板级 loadSeqRef 随 tab 拆分下沉为各子组件独立持有；
 * kind 在各子组件内部唯一，守卫语义与原面板级实现完全一致。
 */
export function useLoadSequence() {
  const seqRef = useRef<Record<string, number>>({});
  const beginLoad = (kind: string): number => {
    const seq = (seqRef.current[kind] ?? 0) + 1;
    seqRef.current[kind] = seq;
    return seq;
  };
  const isStaleLoad = (kind: string, seq: number): boolean => seqRef.current[kind] !== seq;
  return { beginLoad, isStaleLoad };
}
