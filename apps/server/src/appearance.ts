import { randomUUID } from "node:crypto";
import { PhotonImage, resize, SamplingFilter } from "@silvia-odwyer/photon-node";
import { APPEARANCE_GATE, approvedAppearance, appearanceOption, InputError, record, type AppearanceData, type ContextEntry } from "@harness/core";
import { DesignStore, text, strings } from "./design-store.js";
import { publicFetch } from "./web.js";

export function imageBytes(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new InputError("Image must contain 1 byte to 8 MiB", 413);
  const buf = Buffer.from(bytes);
  const mime = buf.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? "image/png" : buf[0] === 255 && buf[1] === 216 ? "image/jpeg" : buf.subarray(0,4).toString() === "RIFF" && buf.subarray(8,12).toString() === "WEBP" ? "image/webp" : "";
  if (!mime) throw new InputError("Use a PNG, JPEG or WebP image");
  // Inspect dimensions before invoking the decoder, including small compressed image bombs.
  let width = 0, height = 0;
  if (mime === "image/png" && buf.length >= 24) {width = buf.readUInt32BE(16);height = buf.readUInt32BE(20);}
  if (mime === "image/jpeg") {
    let offset = 2;
    while (offset + 4 <= buf.length) {
      if (buf[offset++] !== 255) break;
      while (buf[offset] === 255) offset++;
      const marker = buf[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
      if (offset + 2 > buf.length) break;
      const length = buf.readUInt16BE(offset);
      if (length < 2 || offset + length > buf.length) break;
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker) && length >= 7) {height=buf.readUInt16BE(offset+3);width=buf.readUInt16BE(offset+5);break;}
      offset += length;
    }
  }
  if (mime === "image/webp" && buf.length >= 30) {
    const chunk = buf.subarray(12,16).toString();
    if (chunk === "VP8X") {width=1+buf.readUIntLE(24,3);height=1+buf.readUIntLE(27,3);}
    else if (chunk === "VP8 ") {width=buf.readUInt16LE(26)&0x3fff;height=buf.readUInt16LE(28)&0x3fff;}
    else if (chunk === "VP8L" && buf[20] === 0x2f) {const bits=buf.readUInt32LE(21);width=(bits&0x3fff)+1;height=((bits>>>14)&0x3fff)+1;}
  }
  if (!width || !height || width > 8192 || height > 8192 || width * height > 20000000) throw new InputError("Image dimensions are invalid or exceed supported limits");
  let image: PhotonImage | undefined;
  try {
    image = PhotonImage.new_from_byteslice(buf);
    const width = image.get_width(), height = image.get_height();
    if (!width || !height || width > 8192 || height > 8192 || width * height > 20000000) throw new InputError("Image dimensions exceed supported limits");
    const scale = Math.min(1, 640 / Math.max(width, height));
    const thumb = resize(image, Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)), SamplingFilter.Lanczos3);
    try { return { mime, extension: mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg", thumbnail: Buffer.from(thumb.get_bytes_jpeg(82)) }; }
    finally { thumb.free(); }
  } catch (error) { if (error instanceof InputError) throw error; throw new InputError("Image cannot be decoded"); }
  finally { image?.free(); }
}
export class AppearanceService {
  private jobs = new Map<string, {controller: AbortController; done: Promise<void>}>();
  private active = 0;
  constructor(readonly design: DesignStore) {}
  async ensureGate(projectId: string) {
    return this.design.exclusive(projectId, async () => {
      const snapshot = await this.design.read(projectId);
      if (!snapshot.context.entries.some(e => e.id === APPEARANCE_GATE))
        await this.design.patch(projectId, "orchestrator", {id: APPEARANCE_GATE, baseRevision: 0, title: "Appearance review", content: "Generate visual concepts and obtain explicit user approval before detailed engineering.", data: {state: "pending"}, dependsOn: [], artifactIds: [], status: "draft", reason: "Initialize mandatory appearance review"}, {}, true);
    });
  }
  async assertApproved(projectId: string) {
    const entries = (await this.design.read(projectId)).context.entries;
    // Internal deterministic fixtures can omit the workflow; production runs always initialize it.
    if (entries.some(e => e.id === APPEARANCE_GATE) && !approvedAppearance(entries)) throw new InputError("Appearance approval required. Generate visual concepts and wait for explicit user confirmation of the current version.", 409);
  }
  async upload(projectId: string, bytes: Uint8Array, purpose: string) {
    const info = imageBytes(bytes);
    const artifact = await this.design.artifact(projectId, "mechanical", {name: `reference-${randomUUID()}.${info.extension}`, content: bytes, kind: "image", mediaType: info.mime});
    await this.design.patch(projectId, "user", {id: `appearance.reference.${artifact.id}`, owner: "mechanical", baseRevision: 0, title: "User reference image", content: text(purpose, "reference purpose", 1000), data: {kind: "appearance_reference", purpose}, dependsOn: [], artifactIds: [artifact.id], status: "ready", reason: "User uploaded an appearance reference"}, {}, true);
    return artifact;
  }
  async request(projectId: string, input: unknown, runId?: string, signal?: AbortSignal) {
    const body = record(input);
    await this.ensureGate(projectId);
    const config = await this.design.store.privateConfig(), v = config.values;
    if (!v.imageBaseUrl || !v.imageModel) throw new InputError("Configure the image service URL and generation model in Settings");
    const prompt = text(body.prompt, "image prompt", 12000);
    const title = text(body.title, "concept title", 120);
    const description = text(body.description, "concept description", 2000);
    const feedback = body.feedback === undefined ? undefined : text(body.feedback, "feedback", 4000);
    const preserve = body.preserve === undefined ? undefined : text(body.preserve, "preserve", 2000);
    const refs = body.references === undefined ? [] : (Array.isArray(body.references) ? body.references : (() => {throw new InputError("Invalid references");})()).map(value => {const ref = record(value);return {artifactId: text(ref.artifactId, "reference ID", 120), purpose: text(ref.purpose, "reference purpose", 1000)};});
    if (refs.length > 6) throw new InputError("Use at most six reference images");
    const inputIds = strings(body.contextIds ?? [], "contextIds");
    if (inputIds.some(id => id === APPEARANCE_GATE || id.startsWith("appearance.option."))) throw new InputError("Use requirements and constraints as inputs; parentId links previous concept versions");
    const entry = await this.design.exclusive(projectId, async () => {
      const snapshot = await this.design.read(projectId);
      if (snapshot.context.entries.filter(e => appearanceOption(e) && ["queued", "running"].includes(String(e.data.status))).length >= 6) throw new InputError("Six image jobs are already pending in this project", 409);
      const parent = body.parentId ? snapshot.context.entries.find(e => e.id === body.parentId && appearanceOption(e)) : undefined;
      if (body.parentId && (!parent || parent.data.status !== "succeeded")) throw new InputError("Select a completed source concept", 409);
      if (body.parentRevision !== undefined && parent?.revision !== body.parentRevision) throw new InputError("Concept changed. Reload before submitting feedback.", 409);
      const references = [...refs];
      if (parent) references.unshift({artifactId: String(parent.data.imageId), purpose: "Source concept: preserve its identity except for the requested changes"});
      if (references.length && v.imageEditing !== "true") throw new InputError("This image service has editing disabled. Configure reference image/editing support in Settings.");
      for (const ref of references) if (!snapshot.context.artifacts.some(a => a.id === ref.artifactId && a.kind === "image")) throw new InputError("Unknown image reference");
      const inherited = parent?.data.inputRevisions as Record<string, number> | undefined;
      const ids = [...new Set([...Object.keys(inherited ?? {}), ...inputIds])];
      const inputRevisions = Object.fromEntries(ids.map(id => {const e = snapshot.context.entries.find(e => e.id === id);if (!e) throw new InputError(`Unknown input ${id}`);return [id, e.revision];}));
      const retry = body.retryOf ? snapshot.context.entries.find(e => e.id === body.retryOf && appearanceOption(e) && ["failed", "interrupted", "cancelled"].includes(String(e.data.status))) : undefined;
      if (body.retryOf && !retry) throw new InputError("Invalid retry source", 409);
      if (retry && snapshot.context.entries.some(e => appearanceOption(e) && e.data.directionId === retry.data.directionId && Number(e.data.version) > Number(retry.data.version))) throw new InputError("A newer attempt already exists for this direction. Reload before retrying.", 409);
      const directionId = parent ? String(parent.data.directionId) : retry ? String(retry.data.directionId) : randomUUID();
      const version = retry ? Number(retry.data.version) : 1 + Math.max(0, ...snapshot.context.entries.filter(e => appearanceOption(e) && e.data.directionId === directionId).map(e => Number(e.data.version)));
      const data: AppearanceData = {kind: "appearance_option", directionId, version, parentId: parent?.id, title, description, prompt, feedback, preserve, references, inputRevisions, runId: retry ? retry.data.runId as string | undefined : runId, attempts: retry ? Number(retry.data.attempts ?? 1) + 1 : 1, status: "queued", model: references.length ? v.imageEditModel || v.imageModel : v.imageModel, size: v.imageSize, quality: v.imageQuality, outputFormat: v.imageOutputFormat, configRevision: config.revision};
      const result = await this.design.patch(projectId, "mechanical", {id: retry?.id ?? `appearance.option.${randomUUID()}`, baseRevision: retry?.revision ?? 0, title, content: description, data, dependsOn: ids, artifactIds: [], status: "draft", reason: "Queue appearance concept generation"}, {...inputRevisions, ...(retry ? {[retry.id]: retry.revision} : {})}, true);
      // A revision of the approved direction must receive fresh approval.
      const gate = snapshot.context.entries.find(e => e.id === APPEARANCE_GATE)!;
      const selected = snapshot.context.entries.find(e => e.id === gate.data.optionId);
      if (selected?.data.directionId === directionId) await this.resetGate(projectId, gate, "Appearance direction is being revised");
      return result.entry;
    });
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, {once: true});
    if (signal?.aborted) controller.abort();
    const done = this.execute(projectId, entry, config, controller).finally(() => {signal?.removeEventListener("abort", abort);this.jobs.delete(entry.id);});
    void done.catch(() => console.error("Image job persistence failure; recover saved state after resolving storage errors."));
    this.jobs.set(entry.id, {controller, done});
    return entry;
  }
  private async resetGate(projectId: string, gate: ContextEntry, reason: string) {
    await this.design.patch(projectId, "orchestrator", {id: APPEARANCE_GATE, baseRevision: gate.revision, title: gate.title, content: reason, data: {state: "pending"}, dependsOn: [], artifactIds: [], status: "draft", reason}, {[gate.id]: gate.revision}, true);
  }
  private async update(projectId: string, id: string, update: Partial<AppearanceData>, artifactIds?: string[]) {
    return this.design.exclusive(projectId, async () => {
      const e = (await this.design.read(projectId)).context.entries.find(e => e.id === id)!;
      return this.design.patch(projectId, "mechanical", {id, baseRevision: e.revision, title: e.title, content: e.content, data: {...e.data, ...update}, dependsOn: e.dependsOn, artifactIds: artifactIds ?? e.artifactIds, status: update.status === "succeeded" ? "ready" : "draft", reason: `Image job ${update.status ?? "updated"}`}, Object.fromEntries((await this.design.read(projectId)).context.entries.filter(item => [e.id, ...e.dependsOn].includes(item.id)).map(item => [item.id, item.revision])), true);
    });
  }
  private async execute(projectId: string, entry: ContextEntry, config: Awaited<ReturnType<DesignStore["store"]["privateConfig"]>>, controller: AbortController) {
    const data = entry.data as unknown as AppearanceData, v = config.values;
    let acquired = false;
    try {
      while (this.active >= Number(v.imageConcurrency)) await new Promise<void>((resolve, reject) => {const onAbort = () => {clearTimeout(timer); reject(new Error("Cancelled"));}; const timer = setTimeout(() => {controller.signal.removeEventListener("abort", onAbort);resolve();}, 100); if(controller.signal.aborted) onAbort(); else controller.signal.addEventListener("abort", onAbort, {once: true});});
      controller.signal.throwIfAborted();this.active++;acquired = true;
      await this.update(projectId, entry.id, {status: "running"});
      const editing = data.references.length > 0;
      const endpoint = (editing ? v.imageEditEndpoint : v.imageGenerationEndpoint) || `${v.imageBaseUrl.replace(/\/$/, "")}/images/${editing ? "edits" : "generations"}`;
      const headers: Record<string, string> = config.imageApiKey ? {Authorization: `Bearer ${config.imageApiKey}`} : {};
      const prompt = `${data.prompt}\n\n${data.feedback ? `Requested changes: ${data.feedback}\n` : ""}${data.preserve ? `Preserve: ${data.preserve}\n` : ""}Reference purposes: ${data.references.map(r => r.purpose).join("; ")}\nConcept visualization only. Do not add dimension labels, certification claims or presentation text.`;
      let body: string | FormData;
      const fields: Record<string, string> = {model: data.model, prompt, size: data.size, ...(data.quality ? {quality: data.quality} : {}), ...(data.outputFormat && data.outputFormat !== "provider-default" ? {output_format: data.outputFormat} : {})};
      if (editing) {
        const form = new FormData();for (const [key, value] of Object.entries(fields)) form.set(key, value);
        for (const ref of data.references) { const {artifact, content} = await this.design.artifactContent(projectId, ref.artifactId);form.append("image[]", new Blob([new Uint8Array(content)], {type: artifact.mediaType}), artifact.name.split("/").at(-1)!); }
        body = form;
      } else {headers["Content-Type"] = "application/json";body = JSON.stringify({...fields, n: 1});}
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(Number(v.imageTimeout) * 1000)]);
      const response = await fetch(endpoint, {method: "POST", headers, body, signal, redirect: "error"});
      if (!response.ok) throw new Error(`Image provider returned HTTP ${response.status}`);
      const chunks: Uint8Array[] = [];let count = 0;
      if (!response.body) throw new Error("Image provider returned an empty response");
      for await (const chunk of response.body) {count += chunk.length;if (count > 16 * 1024 * 1024) {await response.body.cancel().catch(() => {});throw new Error("Image response exceeds 16 MiB");}chunks.push(chunk);}
      const payload = JSON.parse(Buffer.concat(chunks).toString()) as {data?: Array<{b64_json?: string; url?: string}>};
      const first = payload.data?.[0];
      const bytes = first?.b64_json ? Buffer.from(first.b64_json, "base64") : first?.url ? (await publicFetch(first.url, signal, {}, 0, undefined, true)).bytes : undefined;
      if (!bytes) throw new Error("Image provider returned no image");
      const info = imageBytes(bytes);controller.signal.throwIfAborted();
      const prefix = `concept-${data.directionId}-v${data.version}`;
      const inputRevisions = data.inputRevisions;
      const image = await this.design.artifact(projectId, "mechanical", {name: `${prefix}.${info.extension}`, content: bytes, kind: "image", mediaType: info.mime, runId: data.runId, inputRevisions});
      const thumb = await this.design.artifact(projectId, "mechanical", {name: `${prefix}-preview.jpg`, content: info.thumbnail, kind: "image", mediaType: "image/jpeg", runId: data.runId, inputRevisions});
      controller.signal.throwIfAborted();
      await this.update(projectId, entry.id, {status: "succeeded", imageId: image.id, thumbnailId: thumb.id}, [image.id, thumb.id]);
    } catch (error) {
      const status = controller.signal.aborted ? "cancelled" : "failed";
      // Provider bodies, URLs and credentials are deliberately excluded from diagnostics.
      const message = status === "cancelled" ? "Image job cancelled; previous versions are retained." : error instanceof InputError ? error.message : "Image request failed or timed out. Check service settings and retry explicitly; the provider may already have processed the request.";
      await this.update(projectId, entry.id, {status, error: message});
    } finally {if (acquired) this.active--;}
  }
  async wait(id: string) {await this.jobs.get(id)?.done;}
  async cancel(projectId: string, id: string) {
    const entry = (await this.design.read(projectId)).context.entries.find(e => e.id === id && appearanceOption(e));
    if (!entry) throw new InputError("Concept not found", 404);
    this.jobs.get(id)?.controller.abort();await this.wait(id);
  }
  async confirm(projectId: string, input: unknown) {
    const body = record(input);
    return this.design.exclusive(projectId, async () => {
      const snapshot = await this.design.read(projectId), entries = snapshot.context.entries;
      if (snapshot.runs.some(r => ["queued", "running"].includes(r.status))) throw new InputError("Wait for the active request to finish before approving a concept", 409);
      const option = entries.find(e => e.id === body.optionId && appearanceOption(e));
      const gate = entries.find(e => e.id === APPEARANCE_GATE);
      if (!option || !gate || option.revision !== body.revision || gate.revision !== body.gateRevision || option.status !== "ready" || option.data.status !== "succeeded") throw new InputError("Concept or review changed. Reload and review again.", 409);
      if (entries.some(e => appearanceOption(e) && e.data.directionId === option.data.directionId && Number(e.data.version) > Number(option.data.version))) throw new InputError("Review the newest version of this direction before approving", 409);
      const inputs = option.data.inputRevisions as Record<string, number>;
      if (Object.entries(inputs).some(([id, rev]) => entries.find(e => e.id === id)?.revision !== rev)) throw new InputError("Design inputs changed. Generate an updated concept before approval.", 409);
      if (!option.data.imageId || !snapshot.context.artifacts.some(a => a.id === option.data.imageId && a.kind === "image")) throw new InputError("Concept image is missing", 409);
      return this.design.patch(projectId, "user", {id: gate.id, owner: "orchestrator", baseRevision: gate.revision, title: "Approved appearance", content: `User approved ${option.title}, version ${option.data.version}.`, data: {state: "approved", optionId: option.id, optionRevision: option.revision, approvedAt: new Date().toISOString()}, dependsOn: [option.id], artifactIds: [String(option.data.imageId)], status: "ready", reason: "Explicit user approval of appearance version"}, {}, true);
    });
  }
  async shutdown() {for (const job of this.jobs.values()) job.controller.abort();await Promise.all([...this.jobs.values()].map(j => j.done));}
}
