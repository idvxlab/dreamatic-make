import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Circle,
  Cpu,
  Folder,
  LayoutDashboard,
  LoaderCircle,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import type { Project } from "@harness/core";
import { api, type Config } from "./api";

import type { T } from "./i18n";
import { ProjectPage } from "./components/ProjectPage";
import { SettingsDialog } from "./components/SettingsDialog";
import { BrandMenu } from "./components/BrandMenu";
import { ProjectActionDialog } from "./components/ProjectActionDialog";
import { NewProject } from "./components/NewProject";
export function App() {
  const [config, setConfig] = useState<Config>(),
    [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [search, setSearch] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const [projectAction, setProjectAction] = useState<{ project: Project; action: "rename" | "delete" }>();
  function manageProject(project: Project, action: "rename" | "delete") {
    if (activeId === project.id && dirty && !window.confirm(t("有未保存的更改，继续将放弃这些更改？", "Discard unsaved changes and continue?"))) return;
    setProjectAction({ project, action });
  }
  const [creating, setCreating] = useState(false),
    [dirty, setDirty] = useState(false);
  const t: T = (zh, en) => (config?.values.language === "en" ? en : zh);
  async function load() {
    setLoading(true);
    setError("");
    try {
      const [nextConfig, nextProjects] = await Promise.all([
        api.config(),
        api.projects(),
      ]);
      setConfig(nextConfig);
      setProjects(nextProjects);
      setDirty(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!config) return;
    document.documentElement.lang =
      config.values.language === "en" ? "en" : "zh-CN";
    document.documentElement.dataset.theme = config.values.theme;
  }, [config]);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (dirty || settingsDirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, settingsDirty]);
  function navigate(id?: string) {
    if (
      dirty &&
      !window.confirm(
        t("有未保存的更改，确定离开？", "Discard unsaved changes?"),
      )
    )
      return;
    setDirty(false);
    setActiveId(id);
    window.scrollTo(0, 0);
  }
  const project = projects.find((p) => p.id === activeId);
  const configured = Boolean(config?.values.baseUrl && config.values.modelId);
  const updateProject = (next: Project) =>
    setProjects((current) => current.map((p) => (p.id === next.id ? next : p)));
  return (
    <div className="shell">
      <aside className="sidebar">
        <BrandMenu
          t={t}
          onWorkspace={() => navigate()}
          onSettings={() => setSettingsOpen(true)}
          settingsDisabled={!config || loading}
        />
        <button className="new-project" onClick={() => setCreating(true)}>
          <Plus size={16} />
          {t("新建项目", "New project")}
          <kbd>＋</kbd>
        </button>
        <label className="search">
          <Search size={15} />
          <input
            aria-label={t("搜索项目", "Search projects")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("搜索项目…", "Search projects…")}
          />
        </label>
        <button
          className={`nav ${!project ? "active" : ""}`}
          onClick={() => navigate()}
        >
          <LayoutDashboard size={16} />
          {t("工作台", "Workspace")}
        </button>
        <div className="sidebar-label">
          {t("项目", "PROJECTS")}
          <span>{projects.length.toString().padStart(2, "0")}</span>
        </div>
        <div className="project-list">
          {projects
            .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
            .map((p) => (
              <div className={`project-row ${p.id === activeId ? "selected" : ""}`} key={p.id}>
                <button className="nav" onClick={() => navigate(p.id)} title={p.name}>
                  <Folder size={15} />
                  <span>{p.name}</span>
                </button>
                <div className="project-row-actions">
                  <button type="button" aria-label={t(`重命名 ${p.name}`, `Rename ${p.name}`)} title={t("重命名", "Rename")} onClick={() => manageProject(p, "rename")}><Pencil size={13} /></button>
                  <button type="button" aria-label={t(`删除 ${p.name}`, `Delete ${p.name}`)} title={t("删除", "Delete")} onClick={() => manageProject(p, "delete")}><Trash2 size={13} /></button>
                </div>
              </div>
            ))}
          {!projects.length && (
            <p className="sidebar-empty">
              {t("从一个新项目开始。", "Start with a new project.")}
            </p>
          )}
          {projects.length > 0 &&
            !projects.some((p) =>
              p.name.toLowerCase().includes(search.toLowerCase()),
            ) && (
              <p className="sidebar-empty">
                {t("没有匹配的项目", "No matching projects")}
              </p>
            )}
        </div>
        <div className="sidebar-bottom">
          <div className="runtime-badge">
            <span className="status-dot" />
            <span>Pi 1.3.0</span>
            <small>SDK</small>
          </div>
          <div className="local-label">
            <ShieldCheck size={13} />
            {t("本地工作空间", "Local workspace")}
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div>
            <span className="muted">{t("工作空间", "Workspace")}</span>
            <ChevronRight size={14} />
            <span>{project?.name || t("概览", "Overview")}</span>
          </div>
          <span className="foundation-tag">
            {t("产品原型系统", "PROTOTYPING")}
            <span>v0.1.0</span>
          </span>
        </header>
        {config?.workspaceRestartRequired && (
          <div className="workspace-notice" role="status">
            <Folder size={16} />
            <span>{t("工作目录已保存，重启服务后生效：", "Workspace saved. Restart the server to apply:")} <code>{config.configuredWorkspaceDir}</code></span>
          </div>
        )}
        {error && (
          <div className="error global-error" role="alert">
            {error}
            <button onClick={() => void load()}>
              <RefreshCw size={14} />
              {t("重试", "Retry")}
            </button>
          </div>
        )}
        {loading ? (
          <div className="loading">
            <LoaderCircle className="spin" />
            {t("正在加载工作空间…", "Loading workspace…")}
          </div>
        ) : config ? (
          project ? (
            <ProjectPage
              key={project.id}
              project={project}
              t={t}
              onSave={updateProject}
              onDirty={setDirty}
              modelConfigured={configured}
              onSettings={() => setSettingsOpen(true)}
            />
          ) : (
            <div className="overview">
              <div className="page-heading">
                <div>
                  <div className="eyebrow">Dreamatic·Make</div>
                  <h1>
                    {t(
                      "让产品想法，成为真实原型。",
                      "Make your next product real.",
                    )}
                  </h1>
                  <p>
                    {t(
                      "七个协作角色，一套 Design Context。从硬件选型到结构、固件与制作资料。",
                      "Seven roles, one Design Context. From components to CAD, firmware and assembly.",
                    )}
                  </p>
                </div>
                <span className="version-tile">
                  π<span>1.3.0</span>
                </span>
              </div>
              <div className="overview-grid">
                <section className="start-card">
                  <div className="section-kicker">
                    01 / {t("开始", "GET STARTED")}
                  </div>
                  <div className="start-icon">
                    <Folder size={28} strokeWidth={1.4} />
                  </div>
                  <h2>
                    {t("给想法一个工作空间", "Give your idea a workspace")}
                  </h2>
                  <p>
                    {t(
                      "创建项目、整理需求和笔记。所有内容都保存在本机，随时可以继续。",
                      "Create a project and collect your notes. Everything stays on this computer, ready when you are.",
                    )}
                  </p>
                  <button className="primary" onClick={() => setCreating(true)}>
                    <Plus size={16} />
                    {t("创建项目", "Create project")}
                    <ArrowRight size={16} />
                  </button>
                </section>
                <section className="foundation-card">
                  <div className="section-kicker">
                    02 / {t("基础能力", "PROTOTYPING")}
                  </div>
                  <h2>
                    {t("围绕真实制作展开协作", "Designed around making.")}
                  </h2>
                  <div className="capability">
                    <SlidersHorizontal />
                    <div>
                      <strong>{t("系统配置", "System configuration")}</strong>
                      <p>
                        {t(
                          "模型服务、运行参数与界面偏好",
                          "Model provider, runtime settings and preferences",
                        )}
                      </p>
                    </div>
                    <Check size={16} />
                  </div>
                  <div className="capability">
                    <Folder />
                    <div>
                      <strong>{t("项目管理", "Project management")}</strong>
                      <p>
                        {t(
                          "共享产品上下文、变更追踪与资料包",
                          "Shared context, change tracking and export",
                        )}
                      </p>
                    </div>
                    <Check size={16} />
                  </div>
                  <div className="capability">
                    <Cpu />
                    <div>
                      <strong>{t("智能体", "Agents")}</strong>
                      <p>
                        {t(
                          "产品、硬件、结构、固件、验证、总控与文档",
                          "Product, Hardware, CAD, Firmware, Validation, Orchestrator & Docs",
                        )}
                      </p>
                    </div>
                    <Check size={16} />
                  </div>
                  <button
                    className="text-button"
                    onClick={() => setSettingsOpen(true)}
                  >
                    {t("打开系统设置", "Open settings")}
                    <ArrowRight size={15} />
                  </button>
                </section>
              </div>
              <section className="recent">
                <div className="section-heading">
                  <h2>{t("最近的项目", "Recent projects")}</h2>
                  <span>
                    {projects.length}{" "}
                    {t(
                      "个项目",
                      projects.length === 1 ? "project" : "projects",
                    )}
                  </span>
                </div>
                {projects.length ? (
                  <div className="project-grid">
                    {[...projects]
                      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                      .slice(0, 6)
                      .map((p) => (
                        <button
                          className="project-card"
                          key={p.id}
                          onClick={() => navigate(p.id)}
                        >
                          <Folder size={20} />
                          <strong>{p.name}</strong>
                          <span>
                            {new Date(p.updatedAt).toLocaleDateString(
                              config.values.language === "en"
                                ? "en-US"
                                : "zh-CN",
                            )}
                          </span>
                          <ArrowRight size={15} />
                        </button>
                      ))}
                  </div>
                ) : (
                  <div className="empty-recent">
                    <Folder size={19} />
                    <span>
                      {t(
                        "项目会出现在这里。创建第一个项目，开始记录。",
                        "Your projects will appear here. Create your first to get started.",
                      )}
                    </span>
                  </div>
                )}
              </section>
              <div className="status-strip">
                <span>
                  <span
                    className={`status-dot ${configured ? "" : "neutral"}`}
                  />
                  {configured
                    ? t("模型配置已保存", "Model configuration saved")
                    : t("尚未配置模型服务", "Model provider not configured")}
                </span>
                <span>{t("7 个角色已接入", "7 agents connected")}</span>
                <button onClick={() => setSettingsOpen(true)}>
                  {t("管理配置", "Configure")}
                  <ArrowRight size={13} />
                </button>
              </div>
            </div>
          )
        ) : null}
      </main>
      {settingsOpen && config && (
        <SettingsDialog
          config={config}
          t={t}
          onDirty={setSettingsDirty}
          onClose={() => setSettingsOpen(false)}
          onSave={(next) => {
            setConfig(next);
            setSettingsOpen(false);
          }}
        />
      )}
      {projectAction && config && (
        <ProjectActionDialog
          project={projectAction.project}
          action={projectAction.action}
          workspaceDir={config.workspaceDir}
          t={t}
          onClose={() => setProjectAction(undefined)}
          onSubmit={async name => {
            const target = projectAction.project;
            if (projectAction.action === "rename") {
              const next = await api.renameProject(target, name);
              updateProject(next);
            } else {
              await api.deleteProject(target);
              setProjects(current => current.filter(item => item.id !== target.id));
              if (activeId === target.id) { setActiveId(undefined); setDirty(false); }
            }
            setProjectAction(undefined);
          }}
        />
      )}
      {creating && (
        <NewProject
          t={t}
          onClose={() => setCreating(false)}
          onCreate={async (name) => {
            const next = await api.createProject(name);
            setProjects((p) => [next, ...p]);
            setCreating(false);
            navigate(next.id);
          }}
        />
      )}
    </div>
  );
}
