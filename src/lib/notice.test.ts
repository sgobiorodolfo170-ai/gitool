import { describe, expect, it } from "vitest";
import {
  clearNotices,
  dismissNotice,
  EMPTY_NOTICE_STATE,
  NOTICE_LIMIT,
  noticeTtl,
  pushNotice,
  type Notice,
} from "./notice";

function notice(id: string, kind: Notice["kind"] = "success", message = `m-${id}`): Notice {
  return { id, kind, message };
}

describe("notice 队列", () => {
  it("按顺序入队", () => {
    const state = pushNotice(pushNotice(EMPTY_NOTICE_STATE, notice("1")), notice("2"));

    expect(state.items.map((item) => item.id)).toEqual(["1", "2"]);
  });

  it("超过上限时丢弃最旧的一条", () => {
    let state = EMPTY_NOTICE_STATE;
    for (const id of ["1", "2", "3", "4"]) {
      state = pushNotice(state, notice(id));
    }

    expect(state.items).toHaveLength(NOTICE_LIMIT);
    expect(state.items.map((item) => item.id)).toEqual(["2", "3", "4"]);
  });

  it("同 kind 同文案去重并移动到队尾，沿用原 id", () => {
    const first = pushNotice(EMPTY_NOTICE_STATE, notice("1", "error", "保存失败"));
    const second = pushNotice(first, notice("2", "success", "已保存"));
    const third = pushNotice(second, notice("3", "error", "保存失败"));

    expect(third.items).toHaveLength(2);
    expect(third.items.map((item) => item.id)).toEqual(["2", "1"]);
  });

  it("不同 kind 但同文案不去重（成功与失败必须分开）", () => {
    const state = pushNotice(
      pushNotice(EMPTY_NOTICE_STATE, notice("1", "success", "保存")),
      notice("2", "error", "保存"),
    );

    expect(state.items).toHaveLength(2);
  });

  it("关闭指定提示；未知 id 返回原对象", () => {
    const state = pushNotice(EMPTY_NOTICE_STATE, notice("1"));
    expect(dismissNotice(state, "1").items).toEqual([]);
    expect(dismissNotice(state, "404")).toBe(state);
  });

  it("清空返回空状态", () => {
    expect(clearNotices().items).toEqual([]);
  });

  it("错误停留时间最长，成功最短", () => {
    expect(noticeTtl("error")).toBeGreaterThan(noticeTtl("warning"));
    expect(noticeTtl("warning")).toBeGreaterThan(noticeTtl("info"));
    expect(noticeTtl("info")).toBeGreaterThan(noticeTtl("success"));
  });

  it("不修改传入的状态", () => {
    const state = pushNotice(EMPTY_NOTICE_STATE, notice("1"));
    const snapshot = [...state.items];

    pushNotice(state, notice("2"));
    dismissNotice(state, "1");

    expect(state.items).toEqual(snapshot);
  });
});
