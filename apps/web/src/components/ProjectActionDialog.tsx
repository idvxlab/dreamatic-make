import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { Project } from "@harness/core";
import type { T } from "../i18n";

export function ProjectActionDialog({ project, action, workspaceDir, t, onClose, onSubmit }: {
  project: Project;
  action: "rename" | "delete";
  workspaceDir: string;
  t: T;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(project.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const deleting = action === "delete";
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    dialog.current?.showModal();
    if (!deleting) dialog.current?.querySelector("input")?.select();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [deleting]);
  return (
    <dialog ref={dialog} className="new-dialog" aria-labelledby="project-action-title"
      onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
      <form onSubmit={async event => {
        event.preventDefault();
        setBusy(true);
        setError("");
        try { await onSubmit(name); }
        catch (err) { setError((err as Error).message); setBusy(false); }
      }}>
        <header>
          <span />
          <button type="button" aria-label={t("关闭", "Close")} onClick={onClose} disabled={busy}><X size={18} /></button>
        </header>
        <h2 id="project-action-title">{deleting ? t("删除项目", "Delete project") : t("重命名项目", "Rename project")}</h2>
        <p>{deleting
          ? t(`确定永久删除“${project.name}”？这将删除项目目录中的全部 Context、成果文件和会话，无法撤销。`, `Permanently delete “${project.name}”? This removes its directory, including all Context, artifacts, and sessions. This cannot be undone.`)
          : t("修改项目名称，并同步重命名磁盘上的项目目录。", "Change the project name and rename its directory on disk.")}</p>
        <code className="project-directory">{workspaceDir}/{project.directory ?? project.id}</code>
        {!deleting && <label>{t("项目名称", "Project name")}
          <input required maxLength={120} value={name} disabled={busy} onChange={event => setName(event.target.value)} />
        </label>}
        {error && <p className="error" role="alert">{error}</p>}
        <footer>
          <button type="button" className="secondary" disabled={busy} onClick={onClose}>{t("取消", "Cancel")}</button>
          <button type="submit" className={deleting ? "danger-button" : "primary"} disabled={busy || (!deleting && (!name.trim() || name.trim() === project.name))}>
            {busy ? t("处理中…", "Working…") : deleting ? t("永久删除", "Delete permanently") : t("重命名", "Rename")}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
