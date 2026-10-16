import { useEffect, useRef, useState } from "react";
import { X, Save } from "lucide-react";
import {
  ROLES,
  type ContextEntry,
  type ContextPatch,
  type RoleId,
} from "@harness/core";
import type { T } from "../i18n";
export function ContextEditor({
  entry,
  entries,
  t,
  onSave,
  onClose,
}: {
  entry?: ContextEntry;
  entries: ContextEntry[];
  t: T;
  onSave: (patch: ContextPatch & { owner: RoleId }) => Promise<void>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [id, setId] = useState(entry?.id ?? ""),
    [owner, setOwner] = useState<RoleId>(entry?.owner ?? "product"),
    [title, setTitle] = useState(entry?.title ?? ""),
    [content, setContent] = useState(entry?.content ?? ""),
    [data, setData] = useState(JSON.stringify(entry?.data ?? {}, null, 2)),
    [deps, setDeps] = useState(entry?.dependsOn.join(", ") ?? ""),
    [status, setStatus] = useState<"draft" | "ready">(
      entry?.status === "ready" ? "ready" : "draft",
    ),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    dialog.current?.showModal();
    dialog.current
      ?.querySelector<HTMLInputElement>("input:not(:disabled)")
      ?.focus();
    return () => {
      dialog.current?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="context-editor"
      aria-labelledby="context-editor-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await onSave({
              id,
              owner,
              title,
              content,
              data: JSON.parse(data),
              dependsOn: deps
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
              artifactIds: entry?.artifactIds ?? [],
              baseRevision: entry?.revision ?? 0,
              status,
              reason,
            });
            onClose();
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
      >
        <header>
          <h2 id="context-editor-title">
            {t(
              entry ? "编辑 Context 条目" : "新增 Context 条目",
              entry ? "Edit Context entry" : "New Context entry",
            )}
          </h2>
          <button
            type="button"
            className="icon-button"
            disabled={busy}
            onClick={onClose}
            aria-label={t("关闭", "Close")}
          >
            <X size={18} />
          </button>
        </header>
        <fieldset disabled={busy}>
          <div className="editor-grid">
            <label>
              ID
              <input
                required
                disabled={Boolean(entry)}
                value={id}
                maxLength={120}
                pattern="[a-zA-Z0-9][a-zA-Z0-9_.-]*"
                placeholder="product.requirements"
                onChange={(e) => setId(e.target.value)}
              />
            </label>
            <label>
              {t("负责人", "Owner")}
              <select
                disabled={Boolean(entry)}
                value={owner}
                onChange={(e) => setOwner(e.target.value as RoleId)}
              >
                {ROLES.map((role) => (
                  <option key={role.id} value={role.id}>
                    {t(role.name[0], role.name[1])}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            {t("标题", "Title")}
            <input
              required
              maxLength={160}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            {t("内容", "Content")}
            <textarea
              value={content}
              maxLength={16000}
              onChange={(e) => setContent(e.target.value)}
              rows={6}
            />
          </label>
          <details>
            <summary>
              {t("结构化数据与依赖", "Structured data & dependencies")}
            </summary>
            <label>
              JSON
              <textarea
                value={data}
                onChange={(e) => setData(e.target.value)}
                rows={5}
              />
            </label>
            <label>
              {t(
                "依赖条目 ID，用逗号分隔",
                "Dependency IDs, separated by commas",
              )}
              <input
                value={deps}
                onChange={(e) => setDeps(e.target.value)}
                list="context-ids"
              />
            </label>
            <datalist id="context-ids">
              {entries
                .filter((item) => item.id !== entry?.id)
                .map((item) => (
                  <option key={item.id} value={item.id} />
                ))}
            </datalist>
          </details>
          <label>
            {t("状态", "Status")}
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as "draft" | "ready")}
            >
              <option value="draft">{t("草案", "Draft")}</option>
              <option value="ready">
                {t(
                  "可供使用 / 评审（不代表实测通过）",
                  "Ready for use/review (not physically verified)",
                )}
              </option>
            </select>
          </label>
          <label>
            {t("修改原因", "Change reason")}
            <input
              required
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        </fieldset>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <footer>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={onClose}
          >
            {t("取消", "Cancel")}
          </button>
          <button className="primary" disabled={busy} type="submit">
            <Save size={14} />
            {t("保存条目", "Save entry")}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
