import { useEffect, useRef, useState } from "react";
import {
  Check,
  Cpu,
  FolderOpen,
  LoaderCircle,
  Palette,
  Save,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Terminal,
  X,
} from "lucide-react";
import type { Field, Values } from "@harness/core";
import { api, type Config, type Diagnostic } from "../api";
import type { T } from "../i18n";

export function SettingsDialog({
  config,
  t,
  onSave,
  onDirty,
  onClose,
}: {
  config: Config;
  t: T;
  onSave: (config: Config) => void;
  onDirty: (dirty: boolean) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [values, setValues] = useState<Values>(config.values);
  const [workspaceDir, setWorkspaceDir] = useState(config.configuredWorkspaceDir ?? config.workspaceDir);
  const [imageApiKey, setImageApiKey] = useState("");
  const [clearImageApiKey, setClearImageApiKey] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [searchApiKey, setSearchApiKey] = useState("");
  const [clearSearchApiKey, setClearSearchApiKey] = useState(false);
  const [clearApiKey, setClearApiKey] = useState(false);
  const [group, setGroup] = useState("model");
  const [busy, setBusy] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const [error, setError] = useState("");
  const [diagnostic, setDiagnostic] = useState<Diagnostic>();
  const dirty =
    JSON.stringify(values) !== JSON.stringify(config.values) ||
    workspaceDir !== (config.configuredWorkspaceDir ?? config.workspaceDir) ||
    Boolean(imageApiKey) || clearImageApiKey ||
    Boolean(searchApiKey) ||
    clearSearchApiKey ||
    Boolean(apiKey) ||
    clearApiKey;
  const locked = busy || diagnosing;
  const searchProvider = values.searchProvider === "brave" ? "brave" : "serper";
  const searchName = searchProvider === "serper" ? "Serper" : "Brave Search";
  const searchConfigured = config.searchKeysConfigured?.[searchProvider] ?? (searchProvider === config.values.searchProvider && config.searchApiKeyConfigured);
  const groups = [
    { id: "model", title: t("模型服务", "Model provider"), icon: Cpu },
    { id: "image", title: t("图像服务", "Image service"), icon: Palette },
    { id: "system", title: t("系统参数", "System"), icon: Server },
    {
      id: "appearance",
      title: t("语言与外观", "Language & appearance"),
      icon: Palette,
    },
  ];
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    dialog.current?.showModal();
    dialog.current
      ?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')
      ?.focus();
    return () => {
      dialog.current?.close();
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);
  function close() {
    if (locked) return;
    if (
      dirty &&
      !window.confirm(
        t("有未保存的设置，确定放弃更改？", "Discard unsaved settings?"),
      )
    )
      return;
    onClose();
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      const saved = await api.saveConfig({
        revision: config.revision,
        workspaceDir,
        values,
        apiKey,
        clearApiKey,
        imageApiKey, clearImageApiKey,
        searchApiKey,
        clearSearchApiKey,
      });
      setValues(saved.values);
      setWorkspaceDir(saved.configuredWorkspaceDir);
      setApiKey("");
      setImageApiKey(""); setClearImageApiKey(false);
      setSearchApiKey("");
      setClearApiKey(false);
      setClearSearchApiKey(false);
      onSave(saved);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function renderFields(selected: Field[]) {
    return selected.map((field) => (
      <label
        key={field.key}
        className={field.key === "modelId" ? "field-wide" : undefined}
      >
        <span>{field.label[config.values.language === "en" ? 1 : 0]}</span>
        {field.options ? (
          <select
            value={values[field.key]}
            onChange={(event) =>
              { setValues((current) => ({ ...current, [field.key]: event.target.value }));
                if (field.key === "searchProvider") { setSearchApiKey(""); setClearSearchApiKey(false); }
              }
            }
          >
            {field.options.map((option) => (
              <option key={option} value={option}>
                {(
                  {
                    true: t("启用", "Enabled"),
                    false: t("停用", "Disabled"),
                    zh: "简体中文",
                    en: "English",
                    light: t("浅色", "Light"),
                    dark: t("深色", "Dark"),
                    system: t("跟随系统", "System"),
                    "provider-default": t("服务默认", "Provider default"),
                    "openai-images": "OpenAI Images compatible",
                    serper: "Serper (Google)",
                    brave: "Brave Search",
                    "openai-completions": "Chat Completions",
                    "openai-responses": "Responses API",
                  } as Record<string, string>
                )[option] || option}
              </option>
            ))}
          </select>
        ) : (
          <input
            type={
              field.type === "number"
                ? "number"
                : field.type === "url"
                  ? "url"
                  : "text"
            }
            value={values[field.key]}
            min={field.min}
            max={field.max}
            step={field.type === "number" ? 1 : undefined}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                [field.key]: event.target.value,
              }))
            }
            placeholder={
              field.key === "baseUrl" ? "https://api.example.com/v1" : undefined
            }
          />
        )}
        {field.help && (
          <small>{field.help[config.values.language === "en" ? 1 : 0]}</small>
        )}
      </label>
    ));
  }
  const modelFields = config.fields.filter((field) => field.group === "model");
  return (
    <dialog
      ref={dialog}
      className="settings-dialog"
      aria-labelledby="settings-title"
      onCancel={(event) => event.preventDefault()}
    >
      <header className="settings-dialog-header">
        <span className="dialog-icon">
          <SlidersHorizontal size={21} />
        </span>
        <div>
          <h2 id="settings-title">{t("系统设置", "Settings")}</h2>
          <p>
            {t(
              "管理模型服务、运行参数与界面偏好",
              "Manage model providers, runtime settings and preferences",
            )}
          </p>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label={t("关闭设置", "Close settings")}
          disabled={locked}
          onClick={close}
        >
          <X size={19} />
        </button>
      </header>
      <div className="settings-source">
        <ShieldCheck size={14} />
        <span>
          {t(
            "配置保存在本机，保存后生效",
            "Stored locally. Changes apply after saving.",
          )}
        </span>
        <span className="settings-source-version">Pi 1.3.0</span>
      </div>
      <div
        className="settings-tabs"
        role="tablist"
        aria-label={t("设置分类", "Settings categories")}
      >
        {groups.map((item, index) => (
          <button
            key={item.id}
            id={`settings-tab-${item.id}`}
            role="tab"
            aria-selected={group === item.id}
            aria-controls={`settings-panel-${item.id}`}
            tabIndex={group === item.id ? 0 : -1}
            onClick={() => setGroup(item.id)}
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? groups.length - 1
                    : (index +
                        (event.key === "ArrowRight" ? 1 : -1) +
                        groups.length) %
                      groups.length;
              setGroup(groups[next].id);
              dialog.current
                ?.querySelector<HTMLButtonElement>(
                  `#settings-tab-${groups[next].id}`,
                )
                ?.focus();
            }}
          >
            <item.icon size={16} />
            {item.title}
          </button>
        ))}
      </div>
      <form
        className="settings-dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div
          className="settings-dialog-body"
          role="tabpanel"
          id={`settings-panel-${group}`}
          aria-labelledby={`settings-tab-${group}`}
        >
          <fieldset disabled={locked}>
            {group === "model" && (
              <>
                <section className="settings-block">
                  <div className="settings-block-heading">
                    <h3>{t("连接配置", "Connection")}</h3>
                    <p>
                      {t(
                        "支持 Chat Completions 和 Responses 兼容服务。",
                        "Supports Chat Completions and Responses compatible providers.",
                      )}
                    </p>
                  </div>
                  <div className="settings-fields">
                    {renderFields(
                      modelFields.filter(
                        (field) =>
                          !["contextWindow", "maxTokens"].includes(field.key),
                      ),
                    )}
                    <label>
                      <span>
                        API Key{" "}
                        <em>
                          {config.apiKeyConfigured
                            ? t("已配置", "Configured")
                            : t(
                                "未配置 · 本地无密钥服务可留空",
                                "Not configured · optional for keyless local providers",
                              )}
                        </em>
                      </span>
                      <input
                        type="password"
                        value={apiKey}
                        disabled={clearApiKey}
                        autoComplete="new-password"
                        onChange={(event) => setApiKey(event.target.value)}
                        placeholder={t(
                          "留空保留当前密钥",
                          "Leave blank to keep current key",
                        )}
                      />
                      <small>
                        {t(
                          "密钥仅保存在本机，配置读取接口不会返回原值。",
                          "The key stays on this computer and is never returned by the configuration API.",
                        )}
                      </small>
                    </label>
                    {config.apiKeyConfigured && (
                      <label className="secret-clear">
                        <input
                          type="checkbox"
                          checked={clearApiKey}
                          onChange={(event) => {
                            setClearApiKey(event.target.checked);
                            setApiKey("");
                          }}
                        />
                        <span>
                          {t("清除已保存的密钥", "Remove saved API key")}
                        </span>
                      </label>
                    )}
                  </div>
                </section>
                <details className="settings-advanced">
                  <summary>{t("高级设置", "Advanced settings")}</summary>
                  <div className="settings-fields">
                    {renderFields(
                      modelFields.filter((field) =>
                        ["contextWindow", "maxTokens"].includes(field.key),
                      ),
                    )}
                  </div>
                </details>
              </>
            )}
            {group === "image" && <>
              <section className="settings-block">
                <div className="settings-block-heading"><h3>{t("图像生成与编辑", "Image generation and editing")}</h3><p>{t("配置 OpenAI Images 兼容服务。保存不会发送生成请求；模型必须支持所选参数。", "Configure an OpenAI Images compatible service. Saving makes no generation request; parameters must be supported by your model.")}</p></div>
                <div className="settings-fields">{renderFields(config.fields.filter(f => f.group === "image" && ["imageProtocol", "imageBaseUrl", "imageModel", "imageEditModel", "imageEditing"].includes(f.key)))}</div>
                <label><span>Image API Key · {config.imageApiKeyConfigured ? t("已配置", "Configured") : t("未配置", "Not configured")}</span><input type="password" autoComplete="new-password" value={imageApiKey} disabled={clearImageApiKey} onChange={e => setImageApiKey(e.target.value)} placeholder={t("留空保留当前密钥", "Leave blank to keep the current key")} /></label>
                {config.imageApiKeyConfigured && <label className="secret-clear"><input type="checkbox" checked={clearImageApiKey} onChange={e => {setClearImageApiKey(e.target.checked);setImageApiKey("");}} /><span>{t("清除图像密钥", "Remove image API key")}</span></label>}
              </section>
              <section className="settings-block"><div className="settings-block-heading"><h3>{t("输出设置", "Output settings")}</h3><p>{t("原图保留服务返回的 PNG、JPEG 或 WebP 格式。", "Original PNG, JPEG or WebP output is retained without conversion.")}</p></div><div className="settings-fields">{renderFields(config.fields.filter(f => ["imageSize", "imageQuality", "imageOutputFormat"].includes(f.key)))}</div></section>
              <details className="settings-advanced"><summary>{t("高级设置", "Advanced settings")}</summary><div className="settings-fields">{renderFields(config.fields.filter(f => ["imageGenerationEndpoint", "imageEditEndpoint", "imageConcurrency", "imageTimeout"].includes(f.key)))}</div><p>{t("生成失败后由你决定是否重试，避免网络中断时重复计费。请求超时不限制项目总运行时长。", "Retry explicitly after a failed request to avoid duplicate charges after network interruptions. Request timeout does not limit the total project duration.")}</p></details>
            </>}
            {group === "system" && (
              <>
                <section className="settings-block">
                  <div className="settings-block-heading">
                    <h3>{t("硬件资料搜索", "Component research")}</h3>
                    <p>
                      {t(
                        "选择搜索服务以查找硬件、数据手册和采购来源。未配置密钥时，仍可读取已知公开网页。",
                        "Choose a provider for component, datasheet and supplier research. Known public URLs can be fetched without a search key.",
                      )}
                    </p>
                  </div>
                  <div className="settings-fields search-provider-fields">
                    {renderFields(config.fields.filter(field => field.key === "searchProvider"))}
                  </div>
                  <label>
                    <span>
                      {searchName} API Key{" "}
                      <em>
                        {searchConfigured
                          ? t("已配置", "Configured")
                          : t("未配置", "Not configured")}
                      </em>
                    </span>
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={searchApiKey}
                      disabled={clearSearchApiKey}
                      onChange={(e) => setSearchApiKey(e.target.value)}
                      placeholder={t(
                        "留空保留当前密钥",
                        "Leave blank to keep current key",
                      )}
                    />
                  </label>
                  {searchConfigured && (
                    <label className="secret-clear">
                      <input
                        type="checkbox"
                        checked={clearSearchApiKey}
                        onChange={(e) => {
                          setClearSearchApiKey(e.target.checked);
                          setSearchApiKey("");
                        }}
                      />
                      <span>
                        {t("清除保存的搜索密钥", "Remove saved search key")}
                      </span>
                    </label>
                  )}
                </section>
                <section className="settings-block">
                  <div className="settings-block-heading">
                    <h3>{t("会话运行", "Session runtime")}</h3>
                    <p>
                      {t(
                        "应用于之后创建的 Pi 会话。",
                        "Applies to future Pi sessions.",
                      )}
                    </p>
                  </div>
                  <div className="settings-fields">
                    {renderFields(
                      config.fields.filter((field) => field.group === "system" && field.key !== "searchProvider"),
                    )}
                  </div>
                </section>
                <section className="settings-block">
                  <div className="settings-block-heading">
                    <h3>{t("项目工作目录", "Project workspace")}</h3>
                    <p>{t("每个项目拥有独立文件夹，存放设计、成果和会话。", "Each project has its own folder for designs, artifacts, and sessions.")}</p>
                  </div>
                  <label className="workspace-field">
                    <span>{t("Workspace 路径", "Workspace directory")}</span>
                    <div className="input-with-icon">
                      <FolderOpen size={17} aria-hidden="true" />
                      <input value={workspaceDir} onChange={event => setWorkspaceDir(event.target.value)}
                        disabled={config.workspaceEnvironmentOverride} required spellCheck={false} autoComplete="off"
                        placeholder="/path/to/workspace" aria-describedby="workspace-help" />
                    </div>
                    <small id="workspace-help">{config.workspaceEnvironmentOverride
                      ? t("此路径由启动环境变量 WORKSPACE_DIR 指定，请先移除该覆盖设置。", "This path is controlled by the WORKSPACE_DIR process environment variable. Remove that override to edit it here.")
                      : t("支持绝对路径或相对于项目根目录的路径。保存到 .env，重启服务后生效。", "Use an absolute path or a path relative to the repository root. Saved to .env; takes effect after restarting the server.")}</small>
                  </label>
                  <div className="workspace-status">
                    <span className="workspace-status-label">{t("当前使用", "Currently active")}</span>
                    <code>{config.workspaceDir}</code>
                    {(config.workspaceRestartRequired || workspaceDir !== (config.configuredWorkspaceDir ?? config.workspaceDir)) && (
                      <span className="restart-badge">{t("需要重启", "Restart required")}</span>
                    )}
                  </div>
                  <p className="workspace-guidance">{t("选择其他目录会打开该目录中的项目。现有项目保留在原位置；如需搬迁，请停止服务后移动整个 workspace 文件夹。", "Selecting another directory opens its projects. Existing projects stay in their original location. To relocate them, stop the server and move the complete workspace folder.")}</p>
                  <details className="storage-details">
                    <summary>{t("配置与系统数据", "Configuration & application data")}</summary>
                    <div className="data-location">
                      <span>{t("配置文件", "Configuration file")}</span><code>{config.configFile}</code>
                      <span>{t("系统数据目录", "Application data directory")}</span><code>{config.dataDir}</code>
                    </div>
                  </details>
                </section>
                <section className="settings-block diagnostics">
                  <div>
                    <Terminal size={17} />
                    <strong>{t("Pi 运行时检查", "Pi runtime check")}</strong>
                    <span>1.3.0</span>
                  </div>
                  <p>
                    {t(
                      "用已保存的配置初始化无工具会话。不发送模型请求，也不验证远端连接或密钥。",
                      "Initializes a tool-free session using saved settings. Makes no model request and does not verify remote connectivity or credentials.",
                    )}
                  </p>
                  <button
                    className="secondary"
                    type="button"
                    disabled={
                      locked ||
                      dirty ||
                      !config.values.baseUrl ||
                      !config.values.modelId
                    }
                    onClick={async () => {
                      setDiagnosing(true);
                      setError("");
                      setDiagnostic(undefined);
                      try {
                        setDiagnostic(await api.diagnose());
                      } catch (err) {
                        setError((err as Error).message);
                      } finally {
                        setDiagnosing(false);
                      }
                    }}
                  >
                    {diagnosing ? (
                      <LoaderCircle size={14} className="spin" />
                    ) : (
                      <Cpu size={14} />
                    )}
                    {t("检查 SDK 接入", "Check SDK integration")}
                  </button>
                  {diagnostic && (
                    <p className="success" role="status">
                      <Check size={15} />
                      {t(
                        "本地会话初始化成功",
                        "Local session initialized",
                      )} · {diagnostic.modelId} · {t("工具数", "tools")}:{" "}
                      {diagnostic.activeTools.length}
                    </p>
                  )}
                </section>
              </>
            )}
            {group === "appearance" && (
              <section className="settings-block">
                <div className="settings-block-heading">
                  <h3>{t("语言与外观", "Language & appearance")}</h3>
                  <p>
                    {t(
                      "保存后应用到整个工作空间。",
                      "Changes apply across the workspace after saving.",
                    )}
                  </p>
                </div>
                <div className="settings-fields">
                  {renderFields(
                    config.fields.filter(
                      (field) => field.group === "appearance",
                    ),
                  )}
                </div>
              </section>
            )}
          </fieldset>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="settings-dialog-footer">
          <span aria-live="polite">
            {dirty
              ? t("有未保存的更改", "Unsaved changes")
              : t("所有配置已保存", "All settings saved")}
          </span>
          <button
            className="secondary"
            type="button"
            disabled={locked}
            onClick={close}
          >
            {t("取消", "Cancel")}
          </button>
          <button className="primary" disabled={locked || !dirty} type="submit">
            <Save size={15} />
            {busy ? t("保存中…", "Saving…") : t("保存配置", "Save settings")}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
