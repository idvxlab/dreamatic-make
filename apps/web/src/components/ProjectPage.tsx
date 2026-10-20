import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowDownToLine,
  ArrowDown,
  ArrowRight,
  Box,
  Check,
  ChevronRight,
  ClipboardList,
  Cpu,
  FileText,
  Folder,
  History,
  LoaderCircle,
  MessageSquare,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  Send,
  Square,
  Wrench,
} from "lucide-react";
import {
  ROLES,
  roleName,
  type Project,
  type ContextEntry,
  type WorkspaceView,
  type Artifact,
} from "@harness/core";
import { api } from "../api";
import { createProjectSession } from "../project-session";
import type { T } from "../i18n";
import { RunOutputPanel } from "./RunOutputPanel";
import { DesignReviewCard } from "./DesignReviewCard";
import { ClarificationCard } from "./ClarificationCard";
import { ContextEditor } from "./ContextEditor";
const ModelViewer = lazy(() => import("./ModelViewer"));
const ProductModelWorkspace = lazy(() => import("./ProductModelWorkspace"));
const active = (status: string) => ["queued", "running"].includes(status);
function link(value: unknown) {
  return typeof value === "string" && /^https?:\/\//i.test(value)
    ? value
    : undefined;
}
function display(value: unknown) {
  return value === undefined || value === null || value === ""
    ? "—"
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
}
// Keep all tabs, drafts, dialogs and async work inside a project-keyed lifetime,
// including callers that do not provide their own React key.
export function ProjectPage(props: Parameters<typeof ProjectWorkspace>[0]) {
  return <ProjectWorkspace key={props.project.id} {...props} />;
}
function ProjectWorkspace({
  project,
  t,
  onSave,
  onDirty,
  modelConfigured,
  onSettings,
}: {
  project: Project;
  t: T;
  onSave: (project: Project) => void;
  onDirty: (dirty: boolean) => void;
  modelConfigured: boolean;
  onSettings: () => void;
}) {
  const [name, setName] = useState(project.name),
    [notes, setNotes] = useState(project.notes),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [view, setView] = useState<WorkspaceView>(),
    [tab, setTab] = useState("work"),
    [prompt, setPrompt] = useState(""),
    [filter, setFilter] = useState("all");
  const [evidenceFile, setEvidenceFile] = useState<File>(),
    [observation, setObservation] = useState("");
  const [editor, setEditor] = useState<ContextEntry | "new">(),
    [selectedArtifact, setSelectedArtifact] = useState<string>(),
    [artifactText, setArtifactText] = useState(""),
    [streamConnected, setStreamConnected] = useState(false);
  const feedRef = useRef<HTMLElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const [showLatest, setShowLatest] = useState(false);
  const scrollToLatest = () => {
    const feed = feedRef.current;
    if (feed) feed.scrollTop = feed.scrollHeight;
    followRef.current = true;
    setShowLatest(false);
  };
  useEffect(() => {
    if (tab !== "work" || !view) return;
    const feed = feedRef.current, messages = messagesRef.current;
    if (!feed || !messages) return;
    scrollToLatest();
    const observer = new ResizeObserver(() => {
      if (followRef.current) feed.scrollTop = feed.scrollHeight;
      else setShowLatest(feed.scrollHeight - feed.scrollTop - feed.clientHeight > 80);
    });
    observer.observe(messages);
    return () => observer.disconnect();
  }, [tab, Boolean(view), project.id]);
  const refreshRef = useRef<() => void>(() => {});
  useEffect(() => { setName(project.name); setNotes(project.notes); }, [project.name, project.notes]);
  const dirty = name !== project.name || notes !== project.notes;
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(() => {
    setView(undefined);
    setError("");
    setStreamConnected(false);
    const session = createProjectSession(project.id, {
      load: api.design,
      connect: id => new EventSource(`/api/projects/${id}/events`),
      onUpdate: snapshot => { setView(snapshot); setError(""); },
      onError: setError,
      onConnected: setStreamConnected,
    });
    refreshRef.current = () => void session.refresh();
    return () => {
      session.dispose();
      refreshRef.current = () => {};
    };
  }, [project.id]);
  const currentView = view?.context.projectId === project.id ? view : undefined;
  const artifacts = currentView?.context.artifacts ?? [],
    entries = currentView?.context.entries ?? [],
    runs = [...new Map([...(currentView?.pendingInputRuns ?? []), ...(currentView?.runs ?? [])].map(run => [run.id, run])).values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    running = runs.find((run) => active(run.status)),
    latest = runs.at(-1);
  const file = artifacts.find((item) => item.id === selectedArtifact);
  useEffect(() => {
    setArtifactText("");
    if (
      !file ||
      file.kind === "mesh" ||
      !/^(text\/|application\/json)/.test(file.mediaType)
    )
      return;
    const controller = new AbortController();
    void fetch(api.artifactUrl(project.id, file.id), {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Artifact could not be read");
        return response.text();
      })
      .then((content) => { if (!controller.signal.aborted) setArtifactText(content.slice(0, 200000)); })
      .catch((err) => {
        if (!controller.signal.aborted) setError((err as Error).message);
      });
    return () => controller.abort();
  }, [project.id, file?.id]);
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      refreshRef.current();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const statusLabel = (status: string) =>
    (
      ({
        queued: t("等待中", "Queued"),
        running: t("执行中", "Running"),
        completed: t("本轮完成", "Completed"),
        awaiting_input: t("等待补充信息", "Awaiting input"),
        failed: t("失败", "Failed"),
        partial: t("部分完成", "Partially completed"),
        blocked: t("受阻", "Blocked"),
        stopped: t("已停止", "Stopped"),
        interrupted: t("已中断", "Interrupted"),
        draft: t("草案", "Draft"),
        ready: t("可供评审", "Ready"),
        needs_review: t("需要复核", "Needs review"),
      }) as Record<string, string>
    )[status] ?? status;
  const components = entries
    .filter((entry) => entry.owner === "hardware")
    .flatMap((entry) => {
      const items = Array.isArray(entry.data.components)
        ? entry.data.components
        : entry.data.kind === "component" ||
            entry.data.model ||
            entry.data.purchaseUrl
          ? [entry.data]
          : [];
      return items
        .filter((item) => item && typeof item === "object")
        .map((data, index) => ({
          entry,
          data: data as Record<string, unknown>,
          key: `${entry.id}-${index}`,
        }));
    });
  const stale = (artifact: Artifact) =>
    Object.entries(artifact.inputRevisions).some(([id, revision]) => {
      const entry = entries.find((item) => item.id === id);
      return (
        !entry ||
        (entry.revision !== revision &&
          !entry.artifactIds.includes(artifact.id))
      );
    });
  return (
    <div className={`make-project ${tab === "work" ? "conversation-project" : ""}`}>
      <div className="make-project-heading">
        <div>
          <div className="eyebrow">Dreamatic·Make / PROTOTYPE WORKSPACE</div>
          <h1>{project.name}</h1>
          <p>
            {t(
              "从产品想法，到可制作的终端原型。",
              "From an idea to a buildable product prototype.",
            )}
          </p>
        </div>
        <a className="secondary" href={api.exportUrl(project.id)}>
          <ArrowDownToLine size={15} />
          {t("导出资料包", "Export package")}
        </a>
      </div>
      <div className="make-metrics">
        <span>
          <Folder size={15} /> Design Context{" "}
          <strong>r{view?.context.revision ?? 0}</strong>
        </span>
        <span>
          {entries.length} {t("条产品记录", "entries")}
        </span>
        <span>
          {artifacts.length} {t("个成果文件", "artifacts")}
        </span>
        <span
          className={
            entries.some((entry) => entry.status === "needs_review")
              ? "review-indicator"
              : ""
          }
        >
          {entries.filter((entry) => entry.status === "needs_review").length}{" "}
          {t("项待复核", "need review")}
        </span>
        <span className="stream-indicator">
          <i className={`status-dot ${streamConnected ? "" : "neutral"}`} />
          {streamConnected
            ? t("实时同步", "Live")
            : t("正在重连", "Reconnecting")}
        </span>
      </div>
      <nav className="make-tabs" aria-label={t("项目视图", "Project views")}>
        {[
          {
            id: "work",
            label: t("协作", "Collaboration"),
            icon: MessageSquare,
          },
          { id: "context", label: "Design Context", icon: ClipboardList },
          { id: "bom", label: t("硬件与 BOM", "Hardware & BOM"), icon: Cpu },
          { id: "models", label: t("3D 模型", "3D models"), icon: Box },
          { id: "files", label: t("成果文件", "Artifacts"), icon: FileText },
          { id: "history", label: t("变更记录", "Changes"), icon: History },
          { id: "brief", label: t("项目资料", "Project brief"), icon: Pencil },
        ].map((item) => (
          <button
            key={item.id}
            aria-pressed={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            <item.icon size={14} />
            {item.label}
          </button>
        ))}
      </nav>
      {error && (
        <div role="alert" className="error workspace-error">
          {error}
          <button className="text-button" onClick={() => refreshRef.current()}>
            <RefreshCw size={13} />
            {t("重新读取", "Reload")}
          </button>
        </div>
      )}
      {!currentView ? (
        <div className="loading">
          <LoaderCircle className="spin" />
          {t("正在读取产品上下文…", "Loading product context…")}
        </div>
      ) : (
        <>
          {tab === "work" && (
            <div className="collaboration-layout">
              <section className="collaboration-main">
                <section className="run-feed" ref={feedRef} aria-label={t("对话与执行消息", "Conversation and activity")} onScroll={() => {
                  const feed = feedRef.current;
                  if (!feed) return;
                  followRef.current = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;
                  setShowLatest(!followRef.current);
                }}>
                  <div className="conversation-messages" ref={messagesRef}>
                  <div className="section-heading">
                    <h2>{t("对话", "Conversation")}</h2>
                    <span>
                      {runs.length} {t("轮", "runs")}
                    </span>
                  </div>
                  {!runs.length ? (
                    <div className="collaboration-empty">
                      <Wrench size={30} />
                      <h3>{t("为真实制作组织协作", "Built around making")}</h3>
                      <p>
                        {t(
                          "描述你想做的产品。角色将按任务读取相关资料、维护产品上下文，并保存 CAD、BOM、固件与教程。",
                          "Describe your product. Agents read relevant context and save CAD, BOM, firmware and instructions.",
                        )}
                      </p>
                      <div>
                        <span>{t("定义产品", "Define")}</span>
                        <ChevronRight size={12} />
                        <span>{t("选型与设计", "Design")}</span>
                        <ChevronRight size={12} />
                        <span>{t("集成与交付", "Integrate")}</span>
                      </div>
                    </div>
                  ) : (
                    runs.map((run) => (
                      <article className="run-card" key={run.id}>
                        <header>
                          {["stopped", "interrupted", "failed", "partial", "blocked"].includes(
                            run.status,
                          ) &&
                            !running && (
                              <button
                                type="button"
                                disabled={busy}
                                className="text-button"
                                onClick={() =>
                                  void action(() =>
                                    api.resumeRun(project.id, run.id),
                                  )
                                }
                              >
                                <Play size={12} />
                                {t("从已存成果继续", "Resume saved work")}
                              </button>
                            )}
                        </header>
                        <p className="user-request">{run.userAnswers?.length ? run.userAnswers.map(answer => answer.answer).join(" · ") : run.prompt}</p>
                        <RunOutputPanel run={run} t={t} statusLabel={statusLabel}>
                        <DesignReviewCard key={`${project.id}:${run.id}`} projectId={project.id} entries={entries} runId={run.id} visibleRunIds={runs.map(r => r.id)} disabled={Boolean(running) || dirty} t={t}
                          onChange={() => refreshRef.current()} onContinue={sourceRunId => sourceRunId ? api.resumeRun(project.id, sourceRunId) : api.startRun(project.id, "Continue the project using the exact user-approved appearance version in appearance.review and saved tasks.")}
                          onExplore={request => api.startRun(project.id, request)} />
                        <ClarificationCard run={run} runs={runs} entries={entries} busy={busy} disabled={Boolean(running) || !modelConfigured || dirty} t={t}
                          onSubmit={answers => action(async () => { await api.answerRun(project.id, run.id, answers); followRef.current = true; })} />
                        </RunOutputPanel>
                      </article>
                    ))
                  )}
                  <DesignReviewCard key={`${project.id}:retained-designs`} projectId={project.id} entries={entries} visibleRunIds={runs.map(r => r.id)} disabled={Boolean(running) || dirty} t={t}
                    onChange={() => refreshRef.current()} onContinue={sourceRunId => sourceRunId ? api.resumeRun(project.id, sourceRunId) : api.startRun(project.id, "Continue from the exact approved appearance version in appearance.review and saved work.")}
                    onExplore={request => api.startRun(project.id, request)} />
                  </div>
                </section>
                {showLatest && <button className="jump-to-latest" onClick={scrollToLatest}><ArrowDown size={14} />{t("回到最新消息", "Jump to latest")}</button>}
                <div className="run-request">
                  {!modelConfigured && (
                    <div className="provider-notice">
                      {t(
                        "先配置模型服务，即可开始真实智能体执行。",
                        "Configure a model provider to start real agent execution.",
                      )}
                      <button onClick={onSettings}>
                        {t("打开设置", "Open settings")}
                        <ArrowRight size={13} />
                      </button>
                    </div>
                  )}
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void action(async () => {
                        await api.startRun(project.id, prompt);
                        followRef.current = true;
                        setPrompt("");
                      });
                    }}
                  >
                    <textarea
                      aria-label={t("你的想法或反馈", "Your idea or feedback")}
                      value={prompt}
                      maxLength={12000}
                      rows={3}
                      disabled={busy}
                      onKeyDown={event => {
                        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                          event.preventDefault();
                          if (!running && !busy && modelConfigured && prompt.trim() && !dirty) event.currentTarget.form?.requestSubmit();
                        }
                      }}
                      onChange={(event) => setPrompt(event.target.value)}
                      placeholder={t(
                        "例如：设计一个带旋钮和屏幕的桌面环境监测器，预算 300 元，外壳使用 FDM 打印。先明确需求并寻找合适的硬件。",
                        "For example: design a desktop environmental monitor with a knob and display, budget 300 CNY, and an FDM printed enclosure. Start with requirements and component research.",
                      )}
                    />
                    <div className="composer-footer">
                      <span className="automatic-routing"><Wrench size={13} />{t("自动安排专业角色协作", "Specialists assigned automatically")}</span>
                      {running ? (
                        <button
                          className="secondary"
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void action(() =>
                              api.stopRun(project.id, running.id),
                            )
                          }
                        >
                          <Square size={13} />
                          {t("停止", "Stop")}
                        </button>
                      ) : (
                        <button
                          className="primary"
                          type="submit"
                          disabled={
                            busy || !modelConfigured || !prompt.trim() || dirty
                          }
                        >
                          <Send size={14} />
                          {t("发送", "Send")}
                        </button>
                      )}
                    </div>
                    {dirty && (
                      <small>
                        {t(
                          "项目笔记有未保存的更改，请先在项目资料中保存。",
                          "Save project brief changes before starting an agent.",
                        )}
                      </small>
                    )}
                  </form>
                </div>
              </section>

            </div>
          )}
          {tab === "context" && (
            <section className="context-workspace">
              <div className="context-toolbar">
                <select
                  aria-label={t("筛选 Context 负责人", "Filter Context owner")}
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                >
                  <option value="all">{t("全部角色", "All roles")}</option>
                  {ROLES.map((item) => (
                    <option key={item.id} value={item.id}>
                      {t(item.name[0], item.name[1])}
                    </option>
                  ))}
                </select>
                <button className="primary" onClick={() => setEditor("new")}>
                  <Plus size={14} />
                  {t("新增条目", "New entry")}
                </button>
              </div>
              {!entries.length ? (
                <div className="empty-recent">
                  {t(
                    "还没有 Context 条目。可以手动记录需求，或由智能体开始维护。",
                    "No Context entries yet. Add requirements or ask an agent to begin.",
                  )}
                </div>
              ) : (
                <div className="context-grid">
                  {entries
                    .filter(
                      (entry) => filter === "all" || entry.owner === filter,
                    )
                    .map((entry) => (
                      <article className="context-card" key={entry.id}>
                        <header>
                          <span>{roleName(entry.owner, t("zh", "en"))}</span>
                          <span className={`entry-state ${entry.status}`}>
                            {statusLabel(entry.status)}
                          </span>
                          <button
                            className="icon-button"
                            title={t("编辑条目", "Edit entry")}
                            aria-label={`${t("编辑", "Edit")} ${entry.id}`}
                            onClick={() => setEditor(entry)}
                          >
                            <Pencil size={14} />
                          </button>
                        </header>
                        <h3>{entry.title}</h3>
                        <code>
                          {entry.id} · r{entry.revision}
                        </code>
                        <p>{entry.content}</p>
                        {Object.keys(entry.data).length > 0 && (
                          <details>
                            <summary>
                              {t("结构化数据", "Structured data")}
                            </summary>
                            <pre>{JSON.stringify(entry.data, null, 2)}</pre>
                          </details>
                        )}
                        <footer>
                          <span>
                            {t("依赖", "Depends on")}:{" "}
                            {entry.dependsOn.join(", ") || "—"}
                          </span>
                          <span>
                            {entry.artifactIds.length} {t("个文件", "files")}
                          </span>
                        </footer>
                      </article>
                    ))}
                </div>
              )}
            </section>
          )}
          {tab === "bom" && (
            <section className="bom-panel">
              <div className="section-heading">
                <h2>{t("硬件与采购清单", "Hardware & procurement")}</h2>
                <span>
                  {components.length} {t("项", "items")}
                </span>
              </div>
              <p className="section-description">
                {t(
                  "由硬件角色维护。价格、库存和尺寸必须核实到具体版本；待确认信息保留在记录中。",
                  "Maintained by Hardware. Prices, availability and dimensions require version-specific evidence.",
                )}
              </p>
              {!components.length ? (
                <div className="empty-recent">
                  {t(
                    "暂无结构化零部件。让硬件角色进行选型和采购研究。",
                    "No components yet. Ask Hardware to research and select parts.",
                  )}
                </div>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        {[
                          t("零部件", "Component"),
                          t("型号 / 版本", "Model / revision"),
                          t("数量", "Qty"),
                          t("尺寸 mm", "Dimensions mm"),
                          t("估算成本", "Est. cost"),
                          t("资料 / 采购", "Sources / purchase"),
                        ].map((label) => (
                          <th key={label}>{label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {components.map(({ entry, data, key }) => (
                        <tr key={key}>
                          <td>
                            <strong>{display(data.name ?? entry.title)}</strong>
                            <small>
                              {entry.id}
                              {entry.status === "needs_review" &&
                                ` · ${t("需复核", "Needs review")}`}
                            </small>
                          </td>
                          <td>
                            {display(data.model)}
                            <small>
                              {display(data.version ?? data.revision)}
                            </small>
                          </td>
                          <td>{display(data.quantity)}</td>
                          <td>
                            {display(data.dimensionsMm ?? data.dimensions)}
                          </td>
                          <td>
                            {display(data.cost ?? data.price)}{" "}
                            {display(data.currency)}
                          </td>
                          <td>
                            {link(data.sourceUrl) && (
                              <a
                                href={link(data.sourceUrl)}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {t("规格资料", "Specs")}
                              </a>
                            )}{" "}
                            {link(data.purchaseUrl) && (
                              <a
                                href={link(data.purchaseUrl)}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {t("采购页面", "Purchase")}
                              </a>
                            )}
                            <small>
                              {display(data.checkedAt ?? data.fetchedAt)}
                            </small>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
          {tab === "models" && <Suspense fallback={<div className="loading"><LoaderCircle className="spin" /></div>}>
            <ProductModelWorkspace projectId={project.id} entries={entries} onChanged={() => refreshRef.current()} t={t} />
          </Suspense>}
          {(tab === "models" || tab === "files") && (
            <div className="artifact-workspace">
              <aside className="artifact-list">
                <h2>
                  {tab === "models"
                    ? t("打印模型与 CAD", "Models & CAD")
                    : t("成果文件", "Artifacts")}
                </h2>
                {artifacts
                  .filter(
                    (item) =>
                      tab === "files" || ["mesh", "cad"].includes(item.kind),
                  )
                  .map((item) => (
                    <button
                      key={item.id}
                      className={selectedArtifact === item.id ? "selected" : ""}
                      onClick={() => setSelectedArtifact(item.id)}
                    >
                      {item.kind === "mesh" ? (
                        <Box size={16} />
                      ) : (
                        <FileText size={16} />
                      )}
                      <span>
                        <strong>{item.name}</strong>
                        <small>
                          {roleName(item.owner, t("zh", "en"))} ·{" "}
                          {(item.bytes / 1024).toFixed(1)} KB
                          {stale(item)
                            ? ` · ${t("输入已变化", "Inputs changed")}`
                            : ""}
                        </small>
                      </span>
                    </button>
                  ))}
                {!artifacts.some(
                  (item) =>
                    tab === "files" || ["mesh", "cad"].includes(item.kind),
                ) && <p>{t("尚无成果文件。", "No artifacts yet.")}</p>}
              </aside>
              <section className="artifact-preview">
                {file ? (
                  <>
                    <header>
                      <div>
                        <h3>{file.name}</h3>
                        <small>SHA-256 {file.sha256.slice(0, 16)}…</small>
                      </div>
                      <a
                        className="secondary"
                        href={api.artifactUrl(project.id, file.id)}
                      >
                        <ArrowDownToLine size={14} />
                        {t("下载", "Download")}
                      </a>
                    </header>
                    {stale(file) && (
                      <p className="provider-notice">
                        {t(
                          "此文件引用的输入已变化，请复核后使用。",
                          "An input changed after this artifact was generated. Review before use.",
                        )}
                      </p>
                    )}
                    {file.kind === "mesh" ? (
                      <Suspense
                        fallback={
                          <div className="loading">
                            <LoaderCircle className="spin" />
                          </div>
                        }
                      >
                        <ModelViewer
                          url={api.artifactUrl(project.id, file.id)}
                          t={t}
                        />
                      </Suspense>
                    ) : /^image\/(png|jpeg|webp|gif)$/.test(file.mediaType) ? (
                      <img
                        className="evidence-preview"
                        src={api.artifactUrl(project.id, file.id)}
                        alt={file.name}
                      />
                    ) : !/^(text\/|application\/json)/.test(file.mediaType) ? (
                      <div className="artifact-empty">
                        <FileText size={30} />
                        <p>
                          {t(
                            "此文件请下载后使用对应软件查看。",
                            "Download this file and open it in the appropriate application.",
                          )}
                        </p>
                      </div>
                    ) : (
                      <pre className="artifact-code">
                        {artifactText || t("正在读取文件…", "Loading file…")}
                      </pre>
                    )}
                  </>
                ) : (
                  <div className="artifact-empty">
                    <Box size={38} />
                    <h3>{t("选择成果文件进行查看", "Select an artifact")}</h3>
                    <p>
                      {t(
                        "可旋转查看 STL 模型，或读取 CAD 源文件、固件与教程。",
                        "Inspect STL geometry, CAD sources, firmware and instructions.",
                      )}
                    </p>
                  </div>
                )}
              </section>
            </div>
          )}
          {tab === "history" && (
            <section className="history-panel">
              <form
                className="evidence-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!evidenceFile) return;
                  void action(async () => {
                    await api.uploadEvidence(
                      project.id,
                      evidenceFile,
                      observation,
                    );
                    setEvidenceFile(undefined);
                    setObservation("");
                  });
                }}
              >
                <h3>{t("补充实物测试证据", "Add prototype test evidence")}</h3>
                <p>
                  {t(
                    "上传照片、日志或测量记录，并描述测试条件和结果。提交记录不会自动变成“验证通过”。",
                    "Upload a photo, log or measurement record with test conditions and results. Submission does not automatically certify a passed test.",
                  )}
                </p>
                <label>
                  {t("证据文件（最多 8 MiB）", "Evidence file (up to 8 MiB)")}
                  <input
                    type="file"
                    onChange={(event) =>
                      setEvidenceFile(event.target.files?.[0])
                    }
                  />
                </label>
                <label>
                  {t(
                    "测试条件、观察结果和待确认项",
                    "Test conditions, observations and uncertainty",
                  )}
                  <textarea
                    rows={3}
                    value={observation}
                    maxLength={4000}
                    onChange={(event) => setObservation(event.target.value)}
                  />
                </label>
                <button
                  type="submit"
                  className="secondary"
                  disabled={busy || !evidenceFile || !observation.trim()}
                >
                  {t("保存证据", "Save evidence")}
                </button>
              </form>
              <h2>{t("Context 变更记录", "Context change history")}</h2>
              <p className="section-description">
                {t(
                  "记录修改原因与受影响条目。完整历史包含在导出资料包中。",
                  "Changes record reasons and affected entries. Export includes the full history.",
                )}
              </p>
              {!currentView.context.changes.length ? (
                <div className="empty-recent">
                  {t("暂无变更记录", "No changes yet")}
                </div>
              ) : (
                [...currentView.context.changes].reverse().map((change) => (
                  <article key={change.revision}>
                    <span>r{change.revision}</span>
                    <div>
                      <strong>{change.entryId}</strong>
                      <p>{change.reason}</p>
                      {change.invalidated.length > 0 && (
                        <small className="review-indicator">
                          {t("需要复核", "Needs review")}:{" "}
                          {change.invalidated.join(", ")}
                        </small>
                      )}
                      <small>
                        {change.actor === "user"
                          ? t("用户", "User")
                          : change.actor === "system"
                            ? "System"
                            : roleName(change.actor, t("zh", "en"))}{" "}
                        · {new Date(change.at).toLocaleString()}
                      </small>
                    </div>
                  </article>
                ))
              )}
            </section>
          )}
          {tab === "brief" && (
            <section className="notes-panel make-brief">
              <div className="panel-heading">
                <h2>{t("项目资料", "Project brief")}</h2>
                <span>
                  {dirty
                    ? t("未保存", "Unsaved")
                    : t("已保存到本机", "Saved locally")}
                </span>
              </div>
              <label>
                {t("项目名称", "Project name")}
                <input
                  maxLength={120}
                  value={name}
                  disabled={busy}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label>
                {t("原始需求与补充说明", "Original requirements and notes")}
                <textarea
                  rows={10}
                  value={notes}
                  disabled={busy}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder={t(
                    "记录你的产品想法、可用设备、预算和限制…",
                    "Describe your idea, equipment, budget and constraints…",
                  )}
                />
              </label>
              <p className="section-description">
                {t(
                  "笔记是用户输入；已确认的产品事实由七个角色写入 Design Context。",
                  "Notes are user input. Confirmed product facts live in Design Context.",
                )}
              </p>
              <div className="notes-footer">
                <span>
                  {notes.length} {t("字符", "characters")}
                </span>
                <button
                  className="primary"
                  disabled={busy || !dirty || !name.trim()}
                  onClick={() =>
                    void action(async () =>
                      onSave(await api.updateProject(project, name, notes)),
                    )
                  }
                >
                  <Save size={14} />
                  {t("保存资料", "Save brief")}
                </button>
              </div>
            </section>
          )}
        </>
      )}
      {editor && (
        <ContextEditor
          entry={editor === "new" ? undefined : editor}
          entries={entries}
          t={t}
          onClose={() => setEditor(undefined)}
          onSave={async (patch) => {
            await api.patchContext(project.id, patch);
            refreshRef.current();
          }}
        />
      )}
    </div>
  );
}
