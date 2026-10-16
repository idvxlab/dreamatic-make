import type { IncomingMessage, ServerResponse } from "node:http";
import { InputError, record } from "@harness/core";
import { text } from "./design-store.js";
import type { AgentRuntime } from "./agents/runtime.js";

export async function appearanceAPI(req: IncomingMessage, res: ServerResponse, url: URL, runtime: AgentRuntime, readBody: () => Promise<unknown>, json: (status: number, body: unknown) => void) {
  const match = url.pathname.match(/^\/api\/projects\/([a-f0-9-]+)\/appearance\/(references|confirm|revise|retry|cancel)$/);
  if (!match) return false;
  if (req.method !== "POST") throw new InputError("Method not allowed", 405);
  const [, projectId, action] = match, service = runtime.appearance;
  await runtime.design.projectDir(projectId);
  if (action === "references") {
    const chunks: Buffer[] = [];let bytes = 0;
    for await (const chunk of req) {bytes += chunk.length;if (bytes <= 8 * 1024 * 1024) chunks.push(chunk);}
    if (!bytes || bytes > 8 * 1024 * 1024) throw new InputError("Reference image must contain 1 byte to 8 MiB", 413);
    json(201, await service.upload(projectId, Buffer.concat(chunks), url.searchParams.get("purpose") ?? "Visual design reference"));return true;
  }
  const input = record(await readBody());
  if (action === "confirm") {json(200, await service.confirm(projectId, input));return true;}
  const snapshot = await runtime.design.read(projectId);
  const option = snapshot.context.entries.find(e => e.id === input.optionId && e.id.startsWith("appearance.option."));
  if (!option) throw new InputError("Concept not found", 404);
  if (action === "cancel") {await service.cancel(projectId, option.id);json(200, {ok: true});return true;}
  if (option.revision !== input.revision) throw new InputError("Concept changed. Reload before submitting.", 409);
  const data = option.data;
  if (action === "retry") {
    if (!["failed", "interrupted", "cancelled"].includes(String(data.status))) throw new InputError("Only unsuccessful image jobs can be retried", 409);
    json(202, await service.request(projectId, {...data, retryOf: option.id, contextIds: Object.keys(data.inputRevisions as object), references: (data.references as Array<{artifactId: string}>).filter(r => !data.parentId || r.artifactId !== snapshot.context.entries.find(e => e.id === data.parentId)?.data.imageId)}, data.runId as string | undefined));return true;
  }
  if (snapshot.runs.some(r => ["queued", "running"].includes(r.status))) throw new InputError("Wait for the active request before revising a concept", 409);
  const feedback = text(input.feedback, "modification request", 4000);
  const preserve = text(input.preserve ?? "Keep the selected concept identity, proportions and all features not explicitly changed by the user.", "preservation instructions", 2000);
  json(202, await service.request(projectId, {title: option.title, description: feedback, prompt: data.prompt, parentId: option.id, parentRevision: option.revision, feedback, preserve, references: input.references ?? [], contextIds: Object.keys(data.inputRevisions as object)}, data.runId as string | undefined));
  return true;
}
