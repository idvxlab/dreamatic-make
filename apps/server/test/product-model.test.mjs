import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../dist/store.js";
import { DesignStore } from "../dist/design-store.js";
import { ProductModelService, runProductModel } from "../dist/product-model.js";
import { createApp } from "../dist/app.js";
import { PRODUCT_MODEL_ENTRY, APPEARANCE_GATE } from "@harness/core";

const projection = (inputs = {}) => ({ snapshot_id: "snapshot", input_revisions: inputs, preview_status: "completed", diagnostics: [],
  scene: { bodies: [], envelopes: [], joints: [], collisions: [] }, circuit: { terminals: [], nets: [], behaviors: [] }, flow: { ports: [], paths: [], connections: [], mode: "topology_only" }, result: null });
const runner = async (method, bundle) => ({ ...projection(bundle.input_revisions), result: method === "workspace" ? { status: "completed", frames: [], coverage: ["logic"], diagnostics: [] } : null });
const input = (baseRevision = 0) => ({ bundle: { input_revisions: {} }, scenario: {}, baseRevision });
async function fixture(t, engine = runner) {
  const dir = await mkdtemp(join(tmpdir(), "make-engine-")); t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new Store(dir); await store.init();
  const project = await store.createProject({ name: "Model integration" }), design = new DesignStore(store);
  const service = new ProductModelService(design, engine); t.after(() => service.shutdown());
  return { store, id: project.id, design, service };
}
async function approve(f) {
  await f.design.change(f.id, d => {
    const common = { owner: "mechanical", title: "Offline approval", revision: 1, status: "ready", dependsOn: [], artifactIds: [], content: "Test fixture", updatedAt: new Date().toISOString(), updatedBy: "user" };
    d.context.entries.push({ ...common, id: "appearance.option.test", data: { kind: "appearance_option", status: "succeeded", inputRevisions: {} } },
      { ...common, id: APPEARANCE_GATE, data: { state: "approved", optionId: "appearance.option.test", optionRevision: 1 } });
  });
}

test("import persists one authoritative Context pointer and rejects stale writes and generic edits", async t => {
  const f = await fixture(t), imported = await f.service.import(f.id, input());
  assert.equal(imported.sourceRevision, 1);
  const context = (await f.design.read(f.id)).context, entry = context.entries.find(e => e.id === PRODUCT_MODEL_ENTRY);
  assert.equal(entry.owner, "mechanical"); assert.equal(entry.data.bundle, undefined); assert.equal(entry.artifactIds.length, 1);
  assert.equal(context.artifacts.length, 1);
  await assert.rejects(f.service.import(f.id, input()), /version changed/);
  assert.equal((await f.design.read(f.id)).context.artifacts.length, 1);
  await assert.rejects(f.design.patch(f.id, "user", { id: PRODUCT_MODEL_ENTRY }), /only be changed/);
  await assert.rejects(f.service.simulate(f.id, { baseRevision: 1 }), /approval required/);
  assert.equal((await f.service.load(f.id)).workspace.result, null);
});

test("simulation saves evidence with exact source/approval versions and replays without rerunning", async t => {
  let calls = 0; const f = await fixture(t, async (...args) => { calls++; return runner(...args); });
  await approve(f); await f.service.import(f.id, input());
  const run = await f.service.simulate(f.id, { baseRevision: 1 }); assert.ok(run.resultArtifactId);
  const artifact = await f.design.artifactContent(f.id, run.resultArtifactId);
  assert.equal(artifact.artifact.inputRevisions[PRODUCT_MODEL_ENTRY], 1);
  assert.equal(artifact.artifact.inputRevisions[APPEARANCE_GATE], 1);
  assert.equal((await f.service.load(f.id)).workspace.result.status, "completed"); assert.equal(calls, 2);
  await f.service.import(f.id, input(1));
  const result = (await f.design.read(f.id)).context.entries.find(e => e.id === "validation.product_model");
  assert.equal(result.status, "needs_review");
  assert.equal((await f.service.load(f.id)).workspace.result, null);
});

test("changed approval during execution rejects publication, and operations are mutually exclusive", async t => {
  let release, started;
  const ready = new Promise(resolve => { started = resolve; });
  const f = await fixture(t, async (...args) => {
    if (args[0] === "workspace") { started(); await new Promise(resolve => { release = resolve; }); }
    return runner(...args);
  });
  await approve(f); await f.service.import(f.id, input());
  const running = f.service.simulate(f.id, { baseRevision: 1 }); await ready;
  await assert.rejects(f.service.demo(f.id, "fan"), /busy/);
  await f.design.change(f.id, d => { d.context.entries.find(e => e.id === APPEARANCE_GATE).revision++; });
  release(); await assert.rejects(running, /input changed/);
  assert.equal((await f.design.read(f.id)).context.artifacts.length, 1);
});

test("demo is ephemeral, project-scoped and uses a fixed example allowlist", async t => {
  const f = await fixture(t);
  assert.equal((await f.service.demo(f.id, "fan")).demo, true);
  assert.equal((await f.design.read(f.id)).context.artifacts.length, 0);
  await assert.rejects(f.service.demo(f.id, "../../.env"), /Unknown engine example/);
  await assert.rejects(f.service.demo("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "fan"), /not found/i);
  await assert.rejects(f.service.import(f.id, { ...input(), bundle: { input_revisions: { missing: 3 } } }), /input changed/);
});

test("cancelled execution cannot publish evidence", async t => {
  const f = await fixture(t); await approve(f); await f.service.import(f.id, input());
  const signal = new AbortController(); signal.abort();
  await assert.rejects(f.service.simulate(f.id, { baseRevision: 1 }, signal.signal), /cancelled/);
  assert.equal((await f.design.read(f.id)).context.artifacts.length, 1);
});

test("HTTP integration preserves loopback policy and returns actionable engine errors", async t => {
  const f = await fixture(t);
  const server = createApp(f.store, undefined, { design: f.design, productModel: f.service });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}/api/projects/${f.id}/model`;
  const post = (action, body, extra = {}) => fetch(`${url}/${action}`, { method: "POST", headers: { "Content-Type": "application/json", ...extra }, body: JSON.stringify(body) });
  assert.equal((await fetch(url)).status, 404);
  assert.equal((await post("import", input())).status, 200);
  assert.equal((await fetch(url)).status, 200);
  assert.equal((await post("simulate", { baseRevision: 1 })).status, 409);
  assert.equal((await post("demo", { name: "fan" }, { Origin: "https://example.com" })).status, 403);
  assert.equal((await post("demo", { name: "bad" })).status, 400);
});

test("real Python worker: import, simulate, replay and reject mismatched snapshots offline", { skip: !process.env.MAKE_MODEL_PYTHON }, async t => {
  const f = await fixture(t, runProductModel); await approve(f);
  const bundle = JSON.parse(await readFile("model/examples/actuator.bundle.json", "utf8"));
  const scenario = JSON.parse(await readFile("model/examples/actuator.scenario.json", "utf8"));
  for (const [id, revision] of Object.entries(bundle.input_revisions)) {
    assert.equal(revision, 1);
    await f.design.patch(f.id, "user", { id, owner: "mechanical", title: "Synthetic fixture", content: "Offline test assumptions only", data: {},
      dependsOn: [], artifactIds: [], baseRevision: 0, status: "draft", reason: "Offline integration fixture" });
  }
  const preview = await f.service.import(f.id, { bundle, scenario, baseRevision: 0 });
  assert.equal(preview.workspace.result, null); assert.ok(preview.workspace.scene.bodies[0].world_pose);
  const result = await f.service.simulate(f.id, { baseRevision: 1 });
  assert.equal(result.workspace.result.status, "completed"); assert.equal(result.workspace.result.frames.length, 21);
  assert.deepEqual((await f.service.load(f.id)).workspace.result, result.workspace.result);
  await assert.rejects(f.service.import(f.id, { bundle, scenario: { ...scenario, snapshot_id: "0".repeat(64) }, baseRevision: 1 }), /snapshot/i);
  await assert.rejects(runProductModel("preview", { ...bundle, unexpected: true }, scenario), /Extra inputs/);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(runProductModel("workspace", bundle, scenario, abort.signal), /cancelled/);
});
