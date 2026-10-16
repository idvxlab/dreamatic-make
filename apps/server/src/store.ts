import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { migrateWorkspace, prepareWorkspace } from "./workspace.js";
import { dirname, join, resolve } from "node:path";
import { decodeConfig, encodeConfig, type StoredConfig } from "./env-config.js";
import {
  defaults,
  InputError,
  record,
  validateValues,
  type ConfigSnapshot,
  type Project,
} from "@harness/core";

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}
async function atomicWrite(file: string, value: unknown, raw = false) {
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, raw ? String(value) : JSON.stringify(value, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temp, file);
  } finally {
    await rm(temp, { force: true });
  }
}
export class Store {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    readonly dataDir: string,
    readonly configFile = join(dataDir, ".env"),
    readonly workspaceDir = join(dataDir, "workspace"),
  ) {}
  async init() {
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    await mkdir(dirname(this.configFile), { recursive: true, mode: 0o700 });
    try {
      decodeConfig(await readFile(this.configFile, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const legacyPath = join(this.dataDir, "config.json");
      const saved = await readJson<StoredConfig>(legacyPath, {
        revision: 0, values: {}, apiKey: "",
      });
      const text = encodeConfig({ ...saved, values: { ...defaults, ...saved.values } });
      decodeConfig(text);
      await atomicWrite(this.configFile, text, true);
      await rm(legacyPath, { force: true });
    }
    await migrateWorkspace(this.dataDir, this.workspaceDir, project => this.projectPath(project));
  }

  private mutate<T>(fn: () => Promise<T>): Promise<T> {
    const operation = this.queue.catch(() => undefined).then(fn);
    this.queue = operation;
    return operation;
  }
  async privateConfig(): Promise<StoredConfig> {
    return decodeConfig(await readFile(this.configFile, "utf8"));
  }
  async config(): Promise<ConfigSnapshot> {
    const { revision, values, apiKey, imageApiKey, searchApiKey, serperApiKey, workspaceDir } =
      await this.privateConfig();
    return {
      revision,
      values,
      apiKeyConfigured: Boolean(apiKey),
      imageApiKeyConfigured: Boolean(imageApiKey),
      searchApiKeyConfigured: values.searchProvider === "serper"
        ? Boolean(serperApiKey || process.env.SERPER_API_KEY)
        : Boolean(searchApiKey || process.env.BRAVE_SEARCH_API_KEY),
      searchKeysConfigured: {
        serper: Boolean(serperApiKey || process.env.SERPER_API_KEY),
        brave: Boolean(searchApiKey || process.env.BRAVE_SEARCH_API_KEY),
      },
      dataDir: this.dataDir,
      configFile: this.configFile,
      workspaceDir: this.workspaceDir,
      configuredWorkspaceDir: resolve(dirname(this.configFile), process.env.WORKSPACE_DIR || workspaceDir || this.workspaceDir),
      workspaceRestartRequired: resolve(dirname(this.configFile), process.env.WORKSPACE_DIR || workspaceDir || this.workspaceDir) !== resolve(this.workspaceDir),
      workspaceEnvironmentOverride: Boolean(process.env.WORKSPACE_DIR),
    };
  }
  saveConfig(input: unknown) {
    return this.mutate(async () => {
      const body = record(input);
      if (
        Object.keys(body).some(
          (k) =>
            ![
              "revision",
              "workspaceDir",
              "values",
              "apiKey",
              "clearApiKey",
              "imageApiKey",
              "clearImageApiKey",
              "searchApiKey",
              "clearSearchApiKey",
            ].includes(k),
        )
      )
        throw new InputError("Unknown configuration field");
      const previous = await this.privateConfig();
      if (body.imageApiKey !== undefined && (typeof body.imageApiKey !== "string" || body.imageApiKey.length > 8192 || /[\r\n\0]/u.test(body.imageApiKey))) throw new InputError("Invalid image API key");
      if (body.clearImageApiKey !== undefined && typeof body.clearImageApiKey !== "boolean") throw new InputError("Invalid clearImageApiKey");
      if (body.clearImageApiKey && body.imageApiKey) throw new InputError("Cannot set and clear image key together");
      const imageApiKey = body.clearImageApiKey ? "" : typeof body.imageApiKey === "string" && body.imageApiKey.trim() ? body.imageApiKey.trim() : previous.imageApiKey;

      if (body.revision !== previous.revision)
        throw new InputError(
          "Settings changed elsewhere. Reload settings before saving.",
          409,
        );
      const values = { ...previous.values, ...validateValues(body.values) };
      if (Number(values.maxTokens) > Number(values.contextWindow))
        throw new InputError(
          "Maximum output tokens cannot exceed context window",
        );
      if (
        body.apiKey !== undefined &&
        (typeof body.apiKey !== "string" ||
          body.apiKey.length > 8192 ||
          /[\r\n\0]/u.test(body.apiKey))
      )
        throw new InputError("Invalid API key");
      if (
        body.clearApiKey !== undefined &&
        typeof body.clearApiKey !== "boolean"
      )
        throw new InputError("Invalid clearApiKey");
      if (body.clearApiKey && body.apiKey)
        throw new InputError("Cannot set and clear a key together");
      const apiKey = body.clearApiKey
        ? ""
        : typeof body.apiKey === "string" && body.apiKey.trim()
          ? body.apiKey.trim()
          : previous.apiKey;
      if (
        body.searchApiKey !== undefined &&
        (typeof body.searchApiKey !== "string" ||
          body.searchApiKey.length > 8192 ||
          /[\r\n\0]/u.test(body.searchApiKey))
      )
        throw new InputError("Invalid search API key");
      if (
        body.clearSearchApiKey !== undefined &&
        typeof body.clearSearchApiKey !== "boolean"
      )
        throw new InputError("Invalid clearSearchApiKey");
      if (body.clearSearchApiKey && body.searchApiKey)
        throw new InputError("Cannot set and clear search key together");
      const currentSearchKey = values.searchProvider === "serper" ? previous.serperApiKey : previous.searchApiKey;
      const selectedSearchKey = body.clearSearchApiKey
        ? ""
        : typeof body.searchApiKey === "string" && body.searchApiKey.trim()
          ? body.searchApiKey.trim()
          : (currentSearchKey ?? "");
      let workspaceDir = previous.workspaceDir;
      if (body.workspaceDir !== undefined) {
        if (typeof body.workspaceDir !== "string" || !body.workspaceDir.trim() || body.workspaceDir.length > 4096 || /[\r\n\0]/u.test(body.workspaceDir))
          throw new InputError("Enter a valid workspace directory");
        const target = resolve(dirname(this.configFile), body.workspaceDir.trim());
        if (process.env.WORKSPACE_DIR && target !== resolve(dirname(this.configFile), process.env.WORKSPACE_DIR))
          throw new InputError("WORKSPACE_DIR is controlled by the process environment. Remove that override before changing it in Settings.");
        try { await prepareWorkspace(this.dataDir, target); }
        catch { throw new InputError("Workspace must be writable and separate from application data and legacy project directories."); }
        workspaceDir = target;
      }
      await atomicWrite(this.configFile, encodeConfig({
        revision: previous.revision + 1,
        values,
        apiKey,
        imageApiKey,
        searchApiKey: values.searchProvider === "brave" ? selectedSearchKey : previous.searchApiKey,
        serperApiKey: values.searchProvider === "serper" ? selectedSearchKey : previous.serperApiKey,
        workspaceDir,
      }, await readFile(this.configFile, "utf8")), true);
      return this.config();
    });
  }
  async projects(): Promise<Project[]> {
    return readJson(join(this.workspaceDir, "projects.json"), []);
  }
  createProject(input: unknown) {
    return this.mutate(async () => {
      const { name } = record(input);
      const normalized = projectName(name);
      const projects = await this.projects(),
        now = new Date().toISOString();
      const project: Project = {
        id: randomUUID(),
        name: normalized,
        notes: "",
        createdAt: now,
        updatedAt: now,
      };
      project.directory = projectDirectoryName(project.name, project.id);
      await mkdir(this.projectPath(project), { recursive: true, mode: 0o700 });
      projects.unshift(project);
      await atomicWrite(join(this.workspaceDir, "projects.json"), projects);
      return project;
    });
  }
  updateProject(id: string, input: unknown) {
    return this.mutate(async () => {
      const body = record(input),
        projects = await this.projects(),
        project = projects.find((p) => p.id === id);
      if (!project) throw new InputError("Project not found", 404);
      if (
        Object.keys(body).some(
          (k) => !["name", "notes", "updatedAt"].includes(k),
        )
      )
        throw new InputError("Unknown project field");
      if (body.updatedAt !== project.updatedAt)
        throw new InputError(
          "Project changed elsewhere. Reload before saving.",
          409,
        );
      const oldPath = this.projectPath(project);
      const nextName = body.name === undefined ? project.name : projectName(body.name);
      const renamed = nextName !== project.name;
      if (renamed) await this.assertProjectIdle(project);
      project.name = nextName;
      if (renamed) project.directory = projectDirectoryName(project.name, project.id);
      if (body.notes !== undefined) {
        if (
          typeof body.notes !== "string" ||
          Buffer.byteLength(body.notes) > 262144
        )
          throw new InputError("Notes must be text under 256 KiB");
        project.notes = body.notes;
      }
      project.updatedAt = new Date(
        Math.max(Date.now(), Date.parse(project.updatedAt) + 1),
      ).toISOString();
      const newPath = this.projectPath(project);
      if (renamed) {
        await mkdir(oldPath, { recursive: true, mode: 0o700 });
        await rename(oldPath, newPath);
      }
      try {
        await atomicWrite(join(this.workspaceDir, "projects.json"), projects);
      } catch (error) {
        if (renamed) await rename(newPath, oldPath);
        throw error;
      }
      return project;
    });
  }
  projectPath(project: Project) {
    const directory = project.directory ?? project.id;
    if (!/^[\p{L}\p{N}_-][\p{L}\p{N}_.-]*$/u.test(directory) || directory.includes(".."))
      throw new InputError("Invalid project directory");
    return join(this.workspaceDir, directory);
  }
  private async assertProjectIdle(project: Project) {
    const saved = await readJson<{ runs: Array<{status: string}>; context?: {entries: Array<{id: string; data: Record<string, unknown>}>} }>(
      join(this.projectPath(project), "design.json"), { runs: [] },
    );
    if (saved.runs.some(run => ["queued", "running"].includes(run.status)) || saved.context?.entries.some(e => e.id.startsWith("appearance.option.") && ["queued", "running"].includes(String(e.data.status))))
      throw new InputError("Stop active runs and image jobs before renaming or deleting this project.", 409);
  }
  deleteProject(id: string, input: unknown) {
    return this.mutate(async () => {
      const body = record(input);
      const projects = await this.projects();
      const project = projects.find(item => item.id === id);
      if (!project) throw new InputError("Project not found", 404);
      if (body.updatedAt !== project.updatedAt)
        throw new InputError("Project changed elsewhere. Reload before deleting.", 409);
      await this.assertProjectIdle(project);
      const path = this.projectPath(project);
      const temporary = join(this.workspaceDir, `.deleting-${project.id}-${randomUUID()}`);
      let moved = false;
      try { await rename(path, temporary); moved = true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      try {
        await atomicWrite(join(this.workspaceDir, "projects.json"), projects.filter(item => item.id !== id));
      } catch (error) {
        if (moved) await rename(temporary, path);
        throw error;
      }
      if (moved) await rm(temporary, { recursive: true, force: true });
      return { ok: true };
    });
  }
}
function projectDirectoryName(name: string, id: string) {
  const slug = Array.from(name.normalize("NFKC").replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/gu, "")).slice(0, 48).join("") || "project";
  return `${slug}-${id}`;
}
function projectName(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > 120 ||
    /[\r\n\0]/u.test(value)
  )
    throw new InputError("Project name must contain 1–120 characters");
  return value.trim();
}
