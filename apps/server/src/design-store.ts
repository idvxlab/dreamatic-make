import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  InputError,
  pendingQuestionsForRun,
  record,
  roleIds,
  type RoleId,
  type ProjectDesign,
  type ContextPatch,
  type ContextEntry,
  type Artifact,
  type AgentRun,
  type RunEvent,
} from "@harness/core";
import type { Store } from "./store.js";

export function text(
  value: unknown,
  label: string,
  max = 16000,
  empty = false,
): string {
  if (
    typeof value !== "string" ||
    (!empty && !value.trim()) ||
    value.length > max ||
    value.includes("\0")
  )
    throw new InputError(`Invalid ${label} (maximum ${max} characters)`);
  return value;
}
export function strings(value: unknown, label: string, max = 40): string[] {
  if (
    !Array.isArray(value) ||
    value.length > max ||
    value.some((item) => typeof item !== "string" || item.length > 120) ||
    new Set(value).size !== value.length
  )
    throw new InputError(`Invalid ${label}`);
  return value;
}
function identifier(value: unknown): string {
  const id = text(value, "identifier", 120);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(id))
    throw new InputError("Invalid identifier");
  return id;
}
export class DesignStore {
  private listeners = new Set<(projectId: string) => void>();
  subscribe(listener: (projectId: string) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private queues = new Map<string, Promise<unknown>>();
  private lock = new AsyncLocalStorage<{id: string; active: boolean}>();
  async exclusive<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    const held = this.lock.getStore();
    if (held?.active && held.id === projectId) return operation();
    const pending = (this.queues.get(projectId) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const context = { id: projectId, active: true };
      try { return await this.lock.run(context, operation); }
      finally { context.active = false; }
    });
    this.queues.set(projectId, pending);
    try { return await pending; }
    finally { if (this.queues.get(projectId) === pending) this.queues.delete(projectId); }
  }
  constructor(readonly store: Store) {}
  async projectDir(projectId: string) {
    identifier(projectId);
    const project = (await this.store.projects()).find(item => item.id === projectId);
    if (!project) throw new InputError("Project not found", 404);
    const dir = this.store.projectPath(project);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    return dir;
  }
  async read(projectId: string): Promise<ProjectDesign> {
    return this.exclusive(projectId, async () => {
    const dir = await this.projectDir(projectId);
    try {
      return JSON.parse(await readFile(join(dir, "design.json"), "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return {
        context: {
          schemaVersion: 1,
          projectId,
          revision: 0,
          entries: [],
          changes: [],
          artifacts: [],
        },
        runs: [],
      };
    }
    });
  }
  async change<T>(
    projectId: string,
    operation: (design: ProjectDesign) => T | Promise<T>,
  ): Promise<T> {
    return this.exclusive(projectId, async () => {
        const design = await this.read(projectId),
          result = await operation(design);
        const dir = await this.projectDir(projectId),
          temporary = join(dir, `${randomUUID()}.tmp`);
        try {
          await writeFile(temporary, JSON.stringify(design) + "\n", {
            mode: 0o600,
            flag: "wx",
          });
          await rename(temporary, join(dir, "design.json"));
        } finally {
          await rm(temporary, { force: true });
        }
        for (const listener of this.listeners) {
          try {
            listener(projectId);
          } catch {
            /* A disconnected view cannot fail a committed write. */
          }
        }
        return result;
    });
  }

  async patch(
    projectId: string,
    actor: RoleId | "user",
    input: unknown,
    readSet: Record<string, number> = {},
    trustedAppearance = false,
  ) {
    const body = record(input);
    if (String(body.id).startsWith("appearance.") && !trustedAppearance) throw new InputError("Appearance workflow entries can only be changed through appearance tools and review actions", 403);
    const id = identifier(body.id),
      title = text(body.title, "title", 160),
      content = text(body.content, "content", 16000, true);
    const data = record(body.data);
    if (JSON.stringify(data).length > (trustedAppearance ? 64000 : 16000))
      throw new InputError("Entry data too large");
    const dependsOn = strings(body.dependsOn, "dependsOn"),
      artifactIds = strings(body.artifactIds, "artifactIds");
    const reason = text(body.reason, "reason", 1000);
    if (
      !Number.isSafeInteger(body.baseRevision) ||
      Number(body.baseRevision) < 0
    )
      throw new InputError("baseRevision is required");
    if (!["draft", "ready"].includes(String(body.status)))
      throw new InputError("Status must be draft or ready");
    return this.change(projectId, (design) => {
      const context = design.context,
        previous = context.entries.find((entry) => entry.id === id);
      if (previous && body.owner !== undefined && body.owner !== previous.owner)
        throw new InputError("Entry owner cannot be changed");
      const owner =
        previous?.owner ??
        (actor === "user" ? (String(body.owner) as RoleId) : actor);
      if (!roleIds.includes(owner))
        throw new InputError("Valid owner is required");
      if (actor !== "user" && owner !== actor)
        throw new InputError(
          "Only the owner may modify this entry; propose a change in your own section",
          403,
        );
      if ((previous?.revision ?? 0) !== body.baseRevision)
        throw new InputError(
          "Context conflict. Read the entry again before updating.",
          409,
        );
      if (actor !== "user" && previous && readSet[id] !== previous.revision)
        throw new InputError("Read the current entry before updating", 409);
      for (const [dependency, revision] of Object.entries(readSet)) {
        if (
          context.entries.find((entry) => entry.id === dependency)?.revision !==
          revision
        )
          throw new InputError(
            `Input changed: ${dependency}. Read updated context and retry.`,
            409,
          );
      }
      for (const dependency of dependsOn) {
        if (
          dependency === id ||
          !context.entries.some((entry) => entry.id === dependency)
        )
          throw new InputError(`Unknown or self dependency: ${dependency}`);
        if (
          actor !== "user" &&
          readSet[dependency] !==
            context.entries.find((entry) => entry.id === dependency)!.revision
        )
          throw new InputError(
            `Read dependency before referencing it: ${dependency}`,
            409,
          );
      }
      // Prevent cycles, including a new edge into an existing dependency chain.
      const reaches = (current: string, seen = new Set<string>()): boolean => {
        if (current === id) return true;
        if (seen.has(current)) return false;
        seen.add(current);
        return (
          context.entries.find((entry) => entry.id === current)?.dependsOn ?? []
        ).some((next) => reaches(next, seen));
      };
      if (dependsOn.some((dependency) => reaches(dependency)))
        throw new InputError("Context dependencies must not form a cycle");
      if (body.status === "ready")
        for (const dependency of dependsOn) {
          if (
            context.entries.find((entry) => entry.id === dependency)!.status ===
            "needs_review"
          )
            throw new InputError(`Dependency needs review: ${dependency}`);
        }
      for (const artifactId of artifactIds) {
        const artifact = context.artifacts.find(
          (item) => item.id === artifactId,
        );
        if (!artifact) throw new InputError(`Unknown artifact: ${artifactId}`);
        for (const [dependency, revision] of Object.entries(
          artifact.inputRevisions,
        )) {
          if (
            dependency !== id &&
            context.entries.find((entry) => entry.id === dependency)
              ?.revision !== revision
          )
            throw new InputError(
              `Artifact uses outdated input: ${artifactId}`,
              409,
            );
        }
      }
      const entry: ContextEntry = {
        id,
        owner,
        title,
        content,
        data,
        dependsOn,
        artifactIds,
        status: body.status as ContextPatch["status"],
        revision: (previous?.revision ?? 0) + 1,
        updatedAt: new Date().toISOString(),
        updatedBy: actor,
      };
      if (previous) context.entries[context.entries.indexOf(previous)] = entry;
      else {
        if (context.entries.length >= 1000)
          throw new InputError("Context entry limit reached");
        context.entries.push(entry);
      }
      const invalidated = new Set<string>();
      let expanded = true;
      while (expanded) {
        expanded = false;
        for (const candidate of context.entries) {
          if (
            candidate.id !== id &&
            !invalidated.has(candidate.id) &&
            candidate.dependsOn.some(
              (dependency) => dependency === id || invalidated.has(dependency),
            )
          ) {
            candidate.status = "needs_review";
            candidate.revision++;
            candidate.updatedAt = entry.updatedAt;
            candidate.updatedBy = actor;
            invalidated.add(candidate.id);
            expanded = true;
          }
        }
      }
      for (const run of design.runs)
        for (const task of run.tasks) {
          if (
            (task.inputRevisions[id] !== undefined &&
              task.inputRevisions[id] !== entry.revision) ||
            Object.keys(task.inputRevisions).some((key) => invalidated.has(key))
          )
            task.needsReview = true;
        }
      context.revision++;
      context.changes.push({
        revision: context.revision,
        at: entry.updatedAt,
        actor,
        reason,
        entryId: id,
        before: previous,
        after: structuredClone(entry),
        invalidated: [...invalidated],
      });
      return {
        entry,
        revision: context.revision,
        invalidated: [...invalidated],
      };
    });
  }
  async artifact(
    projectId: string,
    owner: RoleId,
    input: {
      name: string;
      content: string | Uint8Array;
      kind: Artifact["kind"];
      mediaType: string;
      runId?: string;
      sourceUrl?: string;
      inputRevisions?: Record<string, number>;
    },
  ): Promise<Artifact> {
    return this.exclusive(projectId, async () => {
    const name = text(input.name, "artifact filename", 180);
    if (
      name
        .split("/")
        .some((part) => !/^[\p{L}\p{N}_][\p{L}\p{N}_ .-]*$/u.test(part)) ||
      !/\.[a-zA-Z0-9]+$/.test(name) ||
      name.includes("..")
    )
      throw new InputError(
        "Use a safe relative path with a file extension (no absolute paths or ..)",
      );
    const bytes = Buffer.from(input.content);
    if (bytes.length > 8 * 1024 * 1024)
      throw new InputError("Artifact exceeds 8 MiB");
    const id = randomUUID(),
      dir = join(await this.projectDir(projectId), "artifacts");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const artifact: Artifact = {
      id,
      name,
      owner,
      kind: input.kind,
      mediaType: input.mediaType,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      createdAt: new Date().toISOString(),
      runId: input.runId,
      sourceUrl: input.sourceUrl,
      inputRevisions: { ...input.inputRevisions },
    };
    await writeFile(join(dir, id), bytes, { flag: "wx", mode: 0o600 });
    try {
      await this.change(projectId, (design) => {
        design.context.artifacts.push(artifact);
      });
    } catch (error) {
      await rm(join(dir, id), { force: true });
      throw error;
    }
    return artifact;
    });
  }
  async artifactContent(projectId: string, artifactId: string) {
    return this.exclusive(projectId, async () => {
    const design = await this.read(projectId),
      artifact = design.context.artifacts.find(
        (item) => item.id === artifactId,
      );
    if (!artifact) throw new InputError("Artifact not found", 404);
    return {
      artifact,
      content: await readFile(
        join(
          await this.projectDir(projectId),
          "artifacts",
          identifier(artifactId),
        ),
      ),
    };
    });
  }
  async addRun(run: AgentRun) {
    return this.change(run.projectId, (design) => {
      if (
        design.runs.some((item) => ["running", "queued"].includes(item.status))
      )
        throw new InputError("This project already has an active run", 409);
      if (run.userAnswers) {
        const previous = design.runs.find(item => item.id === run.resumedFrom);
        if (!previous || ["queued", "running"].includes(previous.status)) throw new InputError("This run is not waiting for answers", 409);
        const questions = pendingQuestionsForRun(previous, design.context.entries, design.runs);
        if (!questions.length) throw new InputError("Answers were already submitted or no pending questions remain. Reload the project.", 409);
        if (questions.length && (questions.length !== run.userAnswers.length || questions.some(entry => !run.userAnswers!.some(answer => answer.entryId === entry.id && answer.revision === entry.revision))))
          throw new InputError("Questions changed. Reload and answer all pending questions.", 409);
        if (!questions.length) throw new InputError("No pending questions found", 409);
        for (const answer of run.userAnswers) {
          const question = questions.find(entry => entry.id === answer.entryId)!;
          const options = Array.isArray(question.data.options) ? question.data.options : [];
          const type = question.data.inputType ?? (options.length ? "single" : "text");
          if (answer.selectedOptions?.some(option => !options.includes(option)) ||
              (type === "single" && (answer.selectedOptions?.length ?? 0) > 1) ||
              (type === "text" && answer.selectedOptions?.length))
            throw new InputError("Invalid question option selection");
        }
      }
      design.runs.push(run);
    });
  }
  async event(
    projectId: string,
    runId: string,
    type: RunEvent["type"],
    role: RoleId,
    text: string,
  ) {
    return this.change(projectId, (design) => {
      const run = design.runs.find((item) => item.id === runId);
      if (!run) throw new InputError("Run not found", 404);
      run.events.push({
        id: (run.events.at(-1)?.id ?? 0) + 1,
        at: new Date().toISOString(),
        type,
        role,
        text: text.slice(0, 24000),
      });
    });
  }
  async recover() {
    for (const project of await this.store.projects())
      await this.change(project.id, (design) => {
        for (const entry of design.context.entries) {
          if (entry.id.startsWith("appearance.option.") && ["queued", "running"].includes(String(entry.data.status))) {
            entry.data.status = "interrupted";
            entry.data.error = "Service restarted. Retry this image explicitly; no automatic duplicate request was sent.";
            entry.status = "draft";
            entry.revision++;
          }
        }
        for (const run of design.runs)
          if (["queued", "running"].includes(run.status)) {
            run.status = "interrupted";
            run.finishedAt = new Date().toISOString();
            run.error =
              "Service restarted. Saved Context and artifacts are retained; resume explicitly.";
            for (const task of run.tasks)
              if (["queued", "running"].includes(task.status)) {
                task.status = "interrupted";
                task.finishedAt = run.finishedAt;
              }
          }
      });
  }
}
