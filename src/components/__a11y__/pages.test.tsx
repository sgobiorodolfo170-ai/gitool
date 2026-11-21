// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Account, Project } from "../../types";
import type { ProjectsApi } from "../../hooks/useProjects";
import { OverviewWorkspace } from "../OverviewWorkspace";
import { ProjectsPage } from "../ProjectsPage";
import { SettingsWorkspace } from "../SettingsWorkspace";
import { BackupsWorkspace } from "../BackupsWorkspace";

/**
 * axe 冒烟（阶段 E9）：四个高密度页面在 jsdom 下的 serious/critical = 0。
 *
 * 为什么关掉 color-contrast：jsdom 没有真实布局与绘制，axe 的对比度规则
 * 无法得到可靠结果；对比度由阶段 C 的 tokens 校准与三尺寸截图覆盖。
 * 其余规则（名称、角色、列表结构、ARIA 关系）在 jsdom 下有效。
 */
afterEach(cleanup);

const project: Project = {
  id: "p1",
  name: "gitool",
  path: "D:\\work\\gitool",
  provider: "github",
  branch: "main",
  status: "clean",
  commit: "abc1234",
  favorite: false,
  tags: ["tool"],
  files: 12,
  syncLabel: "已同步",
  language: "TypeScript",
  languageColor: "#3178c6",
  summary: "demo",
  updatedAt: "2026-11-21T10:00:00.000Z",
  diskSizeBytes: 1024,
};

const projectsApi: ProjectsApi = {
  projects: [project],
  selectedProject: undefined,
  selectedId: "",
  isRefreshing: false,
  isLoading: false,
  loadError: false,
  setSelectedId: vi.fn(),
  applyProjects: vi.fn(),
  updateProjects: vi.fn(),
  getProjects: () => [project],
  markLoadFailed: vi.fn(),
  toggleFavorite: vi.fn(),
  deleteProjectFromList: async () => {},
  refreshProjects: async () => {},
  moveProject: async () => {},
};

const account: Account = {
  id: "a1",
  provider: "github",
  displayName: "tester",
  username: "tester",
  authType: "pat",
  credentialRef: "cred-1",
  status: "active",
  scopes: ["repo"],
  createdAt: "2026-11-21T10:00:00.000Z",
  updatedAt: "2026-11-21T10:00:00.000Z",
};

async function seriousViolations(container: HTMLElement) {
  const results = await axe.run(container, {
    rules: { "color-contrast": { enabled: false } },
  });
  return results.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
}

describe("axe smoke：页面关键结构", () => {
  it("总览页 0 serious/critical", async () => {
    const { container } = render(
      <OverviewWorkspace
        projects={[project]}
        isLoading={false}
        loadError={false}
        isImporting={false}
        isRefreshing={false}
        cloningRepositoryId={null}
        defaultAccountId=""
        onSelect={() => {}}
        onRefresh={() => {}}
        onImport={() => {}}
        onClone={() => {}}
        onToggleRemoteFavorite={() => {}}
        onOpenProjects={() => {}}
        onOpenRemotes={() => {}}
      />,
    );

    await waitFor(() => expect(container.querySelector(".page-heading")).not.toBeNull());
    expect(await seriousViolations(container)).toEqual([]);
  });

  it("我的项目页 0 serious/critical（列表为 ul/li、行内无嵌套按钮）", async () => {
    const { container } = render(
      <ProjectsPage
        projectsApi={projectsApi}
        initialFilter="all"
        importDomain={{
          isImporting: false,
          importProject: async () => {},
          initNewRepository: async () => {},
          scanDirectoryForImport: async () => {},
        }}
        onNotice={() => {}}
        registerClearDetail={() => {}}
      />,
    );

    await waitFor(() => expect(container.querySelectorAll(".project-row").length).toBe(1));
    expect(await seriousViolations(container)).toEqual([]);
  });

  it("设置页 0 serious/critical", async () => {
    const { container } = render(
      <SettingsWorkspace
        environment={null}
        accounts={[account]}
        accountBusyId={null}
        onAdd={async () => true}
        onTest={async () => {}}
        onDelete={async () => {}}
        onSettingsChange={() => {}}
        onRefreshEnvironment={async () => {}}
        onInstallGit={async () => null}
        installingGit={false}
        installProgress={null}
        fontScale={1}
        onFontScaleChange={() => {}}
        onNotice={() => {}}
      />,
    );

    await waitFor(() => expect(container.querySelector(".page-heading")).not.toBeNull());
    expect(await seriousViolations(container)).toEqual([]);
  });

  it("备份页 0 serious/critical", async () => {
    const { container } = render(<BackupsWorkspace projects={[project]} onNotice={() => {}} />);

    await waitFor(() => expect(container.querySelector(".page-heading")).not.toBeNull());
    expect(await seriousViolations(container)).toEqual([]);
  });
});
