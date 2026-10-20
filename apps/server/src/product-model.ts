import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { APPEARANCE_GATE, approvedAppearance, InputError, PRODUCT_MODEL_ENTRY, record,
  type ContextEntry, type ModelWorkspace, type ProductModelResponse } from "@harness/core";
import { DesignStore } from "./design-store.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const RESULT_ENTRY = "validation.product_model";
export type EngineRunner = (method: "preview" | "workspace", bundle: unknown, scenario: unknown, signal?: AbortSignal) => Promise<ModelWorkspace>;

/** A bounded, single-use Python worker. Never execute model-supplied code or inherit secrets. */
export const runProductModel: EngineRunner = async (method, bundle, scenario, signal) => {
  const requestId = randomUUID();
  const input = JSON.stringify({ request_id: requestId, method, bundle, scenario });
  if (Buffer.byteLength(input) > 1024 * 1024) throw new InputError("Model request exceeds 1 MiB", 413);
  const local = join(root, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const python = process.env.MAKE_MODEL_PYTHON || (existsSync(local) ? local : process.platform === "win32" ? "python" : "python3");
  const env: NodeJS.ProcessEnv = { PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1", PYTHONNOUSERSITE: "1" };
  for (const name of ["PATH", "Path", "SYSTEMROOT", "SystemRoot", "WINDIR", "TEMP", "TMP", "HOME", "LANG"])
    if (process.env[name]) env[name] = process.env[name];
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new InputError("Model operation cancelled", 499));
    const child = spawn(python, ["-s", "-m", "model.cli", "request"], { cwd: root, env, windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] });
    let done = false, size = 0;
    const chunks: Buffer[] = [];
    const finish = (error?: Error, value?: ModelWorkspace) => {
      if (done) return;
      done = true; clearTimeout(timer); signal?.removeEventListener("abort", abort);
      child.kill(); error ? reject(error) : resolve(value!);
    };
    const abort = () => finish(new InputError("Model operation cancelled", 499));
    const timer = setTimeout(() => finish(new InputError("Model operation exceeded 30 seconds; shorten the scenario", 408)), 30000);
    signal?.addEventListener("abort", abort, { once: true });
    child.on("error", () => finish(new InputError("Python engine unavailable. Install the model package and set MAKE_MODEL_PYTHON to its interpreter.", 503)));
    child.stdin.on("error", () => { /* Process close reports startup/protocol failures. */ });
    child.stderr.on("data", () => { /* Never return Python environment or traceback contents. */ });
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) finish(new InputError("Model output exceeds 8 MiB; reduce steps or model size", 413));
      else chunks.push(chunk);
    });
    child.on("close", () => {
      if (done) return;
      try {
        const response = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (response.request_id !== requestId) throw new Error("Unexpected worker response");
        if (response.type === "error") {
          const messages = (response.diagnostics ?? []).slice(0, 8).map((d: {message?: string}) => d.message || "Invalid model");
          return finish(new InputError(messages.join("; ").slice(0, 2000), 422));
        }
        if (response.type !== "result" || !response.payload?.scene || !response.payload?.snapshot_id) throw new Error("Invalid protocol");
        finish(undefined, response.payload);
      } catch {
        finish(new InputError("Python engine failed to start or returned an invalid response. Install the model package in MAKE_MODEL_PYTHON's environment.", 503));
      }
    });
    child.stdin.end(input);
  });
};

function revisions(entries: ContextEntry[], inputs: Record<string, number>) {
  for (const [id, revision] of Object.entries(inputs)) {
    const entry = entries.find(e => e.id === id);
    if (!Number.isSafeInteger(revision) || entry?.revision !== revision || entry.status === "needs_review")
      throw new InputError(`Model input changed or needs review: ${id}`, 409);
  }
}
function baseRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new InputError("baseRevision is required");
  return Number(value);
}

export class ProductModelService {
  private active = new Map<string, AbortController>();
  constructor(readonly design: DesignStore, readonly runner: EngineRunner = runProductModel) {}
  shutdown() { for (const c of this.active.values()) c.abort(); }
  private async operation<T>(id: string, signal: AbortSignal | undefined, work: (signal: AbortSignal) => Promise<T>) {
    if (this.active.has(id) || this.active.size >= 2) throw new InputError("Model engine is busy; retry after the current operation", 409);
    const controller = new AbortController(), abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    this.active.set(id, controller);
    try { await this.design.read(id); return await work(controller.signal); }
    finally { this.active.delete(id); signal?.removeEventListener("abort", abort); }
  }
  async demo(id: string, name: string, signal?: AbortSignal): Promise<ProductModelResponse> {
    if (!["actuator", "fan", "lamp"].includes(name)) throw new InputError("Unknown engine example");
    return this.operation(id, signal, async abort => {
      const [bundle, scenario] = await Promise.all(["bundle", "scenario"].map(kind => readFile(join(root, "model/examples", `${name}.${kind}.json`), "utf8").then(JSON.parse)));
      return { workspace: await this.runner("workspace", bundle, scenario, abort), sourceRevision: 0, demo: true };
    });
  }
  async import(id: string, value: unknown, signal?: AbortSignal): Promise<ProductModelResponse> {
    const input = record(value), base = baseRevision(input.baseRevision);
    const bundle = record(input.bundle), scenario = record(input.scenario);
    return this.operation(id, signal, async abort => {
      const workspace = await this.runner("preview", bundle, scenario, abort);
      if (workspace.preview_status === "failed") throw new InputError(workspace.diagnostics.map(d => d.message).join("; ").slice(0, 2000), 422);
      return this.design.exclusive(id, async () => {
        if (abort.aborted) throw new InputError("Model operation cancelled", 499);
        const context = (await this.design.read(id)).context;
        const previous = context.entries.find(e => e.id === PRODUCT_MODEL_ENTRY);
        if ((previous?.revision ?? 0) !== base) throw new InputError("Model version changed; reload before importing", 409);
        revisions(context.entries, workspace.input_revisions);
        const dependencies = Object.keys(workspace.input_revisions);
        // Prevent a model snapshot from depending on its own downstream results.
        const reachesModel = (key: string, seen = new Set<string>()): boolean => {
          if (key === PRODUCT_MODEL_ENTRY || key === RESULT_ENTRY) return true;
          if (seen.has(key)) return false;
          seen.add(key);
          return (context.entries.find(e => e.id === key)?.dependsOn ?? []).some(k => reachesModel(k, seen));
        };
        if (dependencies.length > 37 || dependencies.some(k => reachesModel(k))) throw new InputError("Invalid model Context dependencies");
        const source = await this.design.artifact(id, "mechanical", { name: "product-model.json", kind: "source", mediaType: "application/json",
          content: JSON.stringify({ bundle, scenario }), inputRevisions: workspace.input_revisions });
        const patched = await this.design.patch(id, "user", { id: PRODUCT_MODEL_ENTRY, owner: "mechanical", baseRevision: base,
          title: "Product model", content: "Imported DSL snapshot and scenario. Preview only; no physical validation.",
          data: { kind: "product_model", sourceArtifactId: source.id, snapshotId: workspace.snapshot_id },
          dependsOn: dependencies, artifactIds: [source.id], status: "draft", reason: "Import a versioned product model" }, workspace.input_revisions, false, true);
        return { workspace, sourceRevision: patched.entry.revision, demo: false };
      });
    });
  }
  private async source(id: string, base?: number) {
    return this.design.exclusive(id, async () => {
      const context = (await this.design.read(id)).context;
      const entry = context.entries.find(e => e.id === PRODUCT_MODEL_ENTRY && e.data.kind === "product_model");
      if (!entry) throw new InputError("Import a model bundle and scenario first", 404);
      if (base !== undefined && entry.revision !== base) throw new InputError("Model version changed; reload before running", 409);
      const sourceId = String(entry.data.sourceArtifactId);
      if (!entry.artifactIds.includes(sourceId)) throw new InputError("Model source is not attached to its Context entry", 409);
      const source = await this.design.artifactContent(id, sourceId);
      const data = JSON.parse(source.content.toString("utf8"));
      return { context, entry, data, source };
    });
  }
  async load(id: string, signal?: AbortSignal): Promise<ProductModelResponse> {
    return this.operation(id, signal, async abort => {
      const { context, entry, data } = await this.source(id);
      const result = context.entries.find(e => e.id === RESULT_ENTRY && e.data.sourceRevision === entry.revision && e.status !== "needs_review");
      if (result && result.artifactIds.includes(String(result.data.resultArtifactId))) {
        const artifact = await this.design.artifactContent(id, String(result.data.resultArtifactId));
        revisions(context.entries, artifact.artifact.inputRevisions);
        return { workspace: JSON.parse(artifact.content.toString("utf8")), sourceRevision: entry.revision, demo: false, resultArtifactId: artifact.artifact.id };
      }
      return { workspace: await this.runner("preview", data.bundle, data.scenario, abort), sourceRevision: entry.revision, demo: false, stale: entry.status === "needs_review" };
    });
  }
  async simulate(id: string, value: unknown, signal?: AbortSignal): Promise<ProductModelResponse> {
    const base = baseRevision(record(value).baseRevision);
    return this.operation(id, signal, async abort => {
      const { context, entry, data, source } = await this.source(id, base);
      const approved = approvedAppearance(context.entries);
      if (!approved) throw new InputError("Appearance approval required before project engineering simulation", 409);
      if (entry.status === "needs_review") throw new InputError("Model inputs changed; review and reimport the model", 409);
      const gate = context.entries.find(e => e.id === APPEARANCE_GATE)!;
      const inputs = { ...source.artifact.inputRevisions, [entry.id]: entry.revision, [approved.id]: approved.revision, [gate.id]: gate.revision };
      revisions(context.entries, inputs);
      const workspace = await this.runner("workspace", data.bundle, data.scenario, abort);
      return this.design.exclusive(id, async () => {
        if (abort.aborted) throw new InputError("Model operation cancelled", 499);
        const current = (await this.design.read(id)).context;
        revisions(current.entries, inputs);
        if (!approvedAppearance(current.entries)) throw new InputError("Appearance approval changed during simulation", 409);
        const result = await this.design.artifact(id, "validation", { name: "model-simulation.json", kind: "evidence", mediaType: "application/json",
          content: JSON.stringify(workspace), inputRevisions: inputs });
        await this.design.patch(id, "user", { id: RESULT_ENTRY, owner: "validation",
          baseRevision: current.entries.find(e => e.id === RESULT_ENTRY)?.revision ?? 0,
          title: "Product model simulation", content: "Lightweight software simulation only. See coverage and diagnostics; no physical validation.",
          data: { kind: "model_simulation", resultArtifactId: result.id, sourceRevision: entry.revision, snapshotId: workspace.snapshot_id, status: workspace.result?.status },
          dependsOn: Object.keys(inputs), artifactIds: [result.id], status: "draft", reason: "Record product model simulation" }, inputs, false, true);
        return { workspace, sourceRevision: entry.revision, demo: false, resultArtifactId: result.id };
      });
    });
  }
}
