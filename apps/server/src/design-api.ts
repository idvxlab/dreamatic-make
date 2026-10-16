import type { IncomingMessage, ServerResponse } from "node:http";
import { InputError, ROLES, record, pendingQuestionsForRun } from "@harness/core";
import { DesignStore } from "./design-store.js";
import { AgentRuntime } from "./agents/runtime.js";
import { appearanceAPI } from "./appearance-api.js";
import { projectZip } from "./export.js";

export async function designAPI(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  design: DesignStore,
  runtime: AgentRuntime,
  readBody: () => Promise<unknown>,
  json: (status: number, body: unknown) => void,
): Promise<boolean> {
  if (await appearanceAPI(req, res, url, runtime, readBody, json)) return true;
  const match = url.pathname.match(
    /^\/api\/projects\/([a-f0-9-]+)\/(design|context|runs|events|artifacts|export|evidence)(?:\/([a-f0-9-]+)(?:\/(stop|resume|answer))?)?$/,
  );
  if (url.pathname === "/api/agents" && req.method === "GET") {
    json(200, {
      agents: ROLES,
      limits: { delegatedTasks: null, toolCalls: null, minutes: null, modelTurns: null, repeatedToolFailures: 3 },
      capabilities: {
        cad: "CSG JSON / OpenSCAD / STL; no STEP or slicer",
        firmware: "Source and instructions; build and flashing not executed",
        search: (await design.store.config()).searchApiKeyConfigured
          ? (await design.store.config()).values.searchProvider === "serper" ? "Serper" : "Brave Search"
          : "Not configured",
        web: "Public HTML/JSON/text; no PDF or JavaScript execution",
      },
    });
    return true;
  }
  if (!match) return false;
  const [, projectId, resource, id, action] = match;
  if (resource === "design" && req.method === "GET") {
    const snapshot = await design.read(projectId);
    // Large history bodies are read on demand; normal updates carry a bounded timeline.
    const changes = snapshot.context.changes
      .slice(-50)
      .map(({ before, after, ...change }) => ({
        ...change,
        title: after.title,
        entryRevision: after.revision,
      }));
    json(200, {
      ...snapshot,
      context: { ...snapshot.context, changes },
      pendingInputRuns: snapshot.runs.filter(run => pendingQuestionsForRun(run, snapshot.context.entries, snapshot.runs).length).map(run => ({ ...run, events: [] })),
      runs: snapshot.runs
        .slice(-15)
        .map((run) => ({ ...run, events: run.events.slice(-160) })),
    });
    return true;
  }
  if (resource === "context" && req.method === "PATCH") {
    json(200, await design.patch(projectId, "user", await readBody()));
    return true;
  }
  if (resource === "context" && req.method === "GET") {
    json(200, (await design.read(projectId)).context);
    return true;
  }
  if (resource === "runs" && !id && req.method === "POST") {
    const input = record(await readBody());
    json(202, await runtime.start(projectId, { prompt: input.prompt, role: "orchestrator" }));
    return true;
  }
  if (resource === "runs" && id && action === "stop" && req.method === "POST") {
    await readBody();
    await runtime.stop(projectId, id);
    json(202, { ok: true });
    return true;
  }
  if (
    resource === "runs" &&
    id &&
    action === "resume" &&
    req.method === "POST"
  ) {
    const previous = (await design.read(projectId)).runs.find(
      (run) => run.id === id,
    );
    if (!previous) throw new InputError("Run not found", 404);
    await readBody();
    json(
      202,
      await runtime.start(projectId, {
        role: "orchestrator",
        prompt: previous.prompt,
        resumedFrom: previous.id,
      }),
    );
    return true;
  }
  if (resource === "runs" && id && action === "answer" && req.method === "POST") {
    const previous = (await design.read(projectId)).runs.find(run => run.id === id);
    if (!previous) throw new InputError("Run not found", 404);
    const input = record(await readBody());
    if (!Array.isArray(input.answers) || !input.answers.length) throw new InputError("Provide answers to continue");
    json(202, await runtime.start(projectId, { role: "orchestrator", prompt: previous.prompt, resumedFrom: previous.id, userAnswers: input.answers }));
    return true;
  }
  if (resource === "evidence" && req.method === "POST") {
    const name = url.searchParams.get("name") ?? "evidence.bin";
    const description = url.searchParams.get("description") ?? "";
    if (!description.trim() || description.length > 4000)
      throw new InputError(
        "Describe the test, observation and remaining uncertainty (maximum 4000 characters)",
      );
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      if (length <= 8 * 1024 * 1024) chunks.push(chunk);
    }
    if (!length || length > 8 * 1024 * 1024)
      throw new InputError("Evidence file must contain 1 byte to 8 MiB", 413);
    const artifact = await design.artifact(projectId, "validation", {
      name,
      content: Buffer.concat(chunks),
      kind: "evidence",
      mediaType:
        req.headers["content-type"]?.split(";")[0] ??
        "application/octet-stream",
    });
    const result = await design.patch(projectId, "user", {
      id: `validation.evidence.${artifact.id}`,
      owner: "validation",
      baseRevision: 0,
      title: name,
      content: description,
      data: {
        kind: "user_observation",
        reportedAt: new Date().toISOString(),
        validationStatus: "reported_not_independently_verified",
      },
      dependsOn: [],
      artifactIds: [artifact.id],
      status: "draft",
      reason: "User submitted prototype test evidence",
    });
    json(201, { artifact, entry: result.entry });
    return true;
  }
  if (resource === "artifacts" && id && req.method === "GET") {
    const { artifact, content } = await design.artifactContent(projectId, id);
    // Generated HTML/SVG/code is always served as an attachment, never as active app content.
    res.writeHead(200, {
      "Content-Type": artifact.mediaType,
      "Content-Disposition": `${artifact.kind === "image" && /^(image\/(png|jpeg|webp))$/.test(artifact.mediaType) ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(artifact.name.split("/").at(-1)!)}`,
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(content);
    return true;
  }
  if (resource === "export" && req.method === "GET") {
    const { zip, filename } = await projectZip(design, projectId);
    res.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    });
    zip.on("error", () => res.destroy());
    res.on("close", () =>
      (zip.outputStream as import("node:stream").Readable).destroy(),
    );
    zip.outputStream.pipe(res);
    zip.end();
    return true;
  }
  if (resource === "events" && req.method === "GET") {
    await design.projectDir(projectId);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write('data: {"changed":true}\n\n');
    let pending: NodeJS.Timeout | undefined;
    const unsubscribe = design.subscribe((changed) => {
      if (changed !== projectId || pending) return;
      pending = setTimeout(() => {
        pending = undefined;
        res.write('data: {"changed":true}\n\n');
      }, 400);
    });
    const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 20000);
    heartbeat.unref();
    res.on("close", () => {
      unsubscribe();
      clearInterval(heartbeat);
      if (pending) clearTimeout(pending);
    });
    return true;
  }
  throw new InputError("Design endpoint not found", 404);
}
