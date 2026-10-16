import { useEffect, useRef, useState } from "react";
import { Folder, X, ArrowRight } from "lucide-react";
import type { T } from "../i18n";

export function NewProject({
  t,
  onClose,
  onCreate,
}: {
  t: T;
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    dialog.current?.showModal();
    dialog.current?.querySelector("input")?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="new-dialog"
      aria-labelledby="new-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onCreate(name);
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
      >
        <header>
          <span className="dialog-icon">
            <Folder size={22} />
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            aria-label={t("关闭", "Close")}
          >
            <X size={18} />
          </button>
        </header>
        <h2 id="new-title">{t("创建新项目", "Create a project")}</h2>
        <p>
          {t(
            "从一个名字开始，慢慢完善你的想法。",
            "Start with a name. Give your idea room to grow.",
          )}
        </p>
        <label>
          {t("项目名称", "Project name")}
          <input
            autoFocus
            required
            maxLength={120}
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("例如：下一代工作空间", "e.g. The next workspace")}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button
            className="secondary"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            {t("取消", "Cancel")}
          </button>
          <button
            className="primary"
            disabled={busy || !name.trim()}
            type="submit"
          >
            {busy ? t("创建中…", "Creating…") : t("创建项目", "Create project")}
            <ArrowRight size={14} />
          </button>
        </footer>
      </form>
    </dialog>
  );
}
