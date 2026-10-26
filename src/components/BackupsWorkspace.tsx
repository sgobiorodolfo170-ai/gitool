import { useEffect, useState } from "react";
import { Archive, Check, HardDrive, RefreshCw } from "lucide-react";
import type { BackupRecord, Project } from "../types";
import { getDesktopBridge } from "../lib/bridge";

import { formatBytes } from "../lib/format";

export function BackupsWorkspace({ projects }: { projects: Project[] }) {
  const bridge = getDesktopBridge();
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!bridge) return;
    setBackups(await bridge.listBackups());
  };

  useEffect(() => { void load(); }, []);

  const createBackup = async () => {
    if (!bridge || !selectedProjectId) return;
    const project = projects.find((item) => item.id === selectedProjectId);
    if (!project) return;
    setBusy(true);
    try {
      const settings = await bridge.loadSettings().catch(() => null);
      const targetDirectory = await bridge.selectDirectory(settings?.defaultBackupDirectory || undefined);
      if (!targetDirectory) return;
      const record = await bridge.createBackup({ projectId: project.id, projectName: project.name, sourcePath: project.path, targetDirectory });
      setNotice(record.status === "ok" ? `备份完成：${record.archivePath}` : `备份失败：${record.error}`);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "备份失败");
    } finally {
      setBusy(false);
    }
  };

  const restoreBackup = async (backup: BackupRecord) => {
    if (!bridge) return;
    if (!window.confirm("恢复会解压到您选择的空目录。确定继续吗？")) return;
    setBusy(true);
    try {
      const targetDirectory = await bridge.selectDirectory();
      if (!targetDirectory) return;
      await bridge.restoreBackup({ archivePath: backup.archivePath, targetDirectory });
      setNotice("恢复完成，可到「我的项目」导入该目录");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "恢复失败");
    } finally {
      setBusy(false);
    }
  };

  return <div className="module-page">
    <div className="module-hero"><div className="module-icon"><Archive size={21} /></div><div><div className="eyebrow"><span className="eyebrow-line" />RECOVERY</div><h1>备份中心</h1><p>将项目打包为 ZIP（含 .git），可在新目录完整恢复。</p></div></div>
    {notice && <div className="toast"><Check size={16} />{notice}</div>}
    <div className="remote-toolbar"><label className="account-select"><span>选择要备份的项目</span><select value={selectedProjectId} onChange={(event) => setSelectedProjectId(event.target.value)}><option value="">选择项目</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label><button className="button primary" onClick={createBackup} disabled={busy || !selectedProjectId}><Archive size={15} />{busy ? "处理中..." : "备份到目录"}</button></div>
    <section className="remote-list-panel"><div className="panel-heading"><div><h2>备份记录</h2><span>{backups.length} 条</span></div><button className="bare-button" onClick={() => void load()}><RefreshCw size={16} /></button></div>{backups.length ? <div className="remote-list">{backups.map((backup) => <div className="remote-row" key={backup.id}><div className="remote-main"><div className="remote-title"><strong>{backup.projectName}</strong><span className={`status-pill ${backup.status === "ok" ? "status-clean" : "status-conflicted"}`}>{backup.status === "ok" ? "成功" : "失败"}</span></div><p>{backup.archivePath}</p><div className="remote-meta"><span><HardDrive size={12} />{backup.sizeBytes > 0 ? formatBytes(backup.sizeBytes) : "—"}</span><span>{backup.createdAt}</span>{backup.error && <code>{backup.error.slice(0, 120)}</code>}</div></div>{backup.status === "ok" && <button className="button secondary compact-button" onClick={() => restoreBackup(backup)} disabled={busy}>恢复</button>}</div>)}</div> : <div className="accounts-empty"><Archive size={22} /><strong>还没有备份</strong><span>选择项目并点击「备份到目录」。</span></div>}</section>
  </div>;
}
