import test from "node:test";
import { request as httpRequest } from "node:http";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  mkdir,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../dist/store.js";
import { createApp } from "../dist/app.js";
import { createHarnessSession } from "@harness/core/pi";
import { defaults } from "@harness/core";

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "harness-test-"));
  const store = new Store(dir);
  await store.init();
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, store };
}
test("configuration is atomic, validated, revisioned, and secret-safe", async (t) => {
  const { dir, store } = await fixture(t);
  const initial = await store.config();
  assert.equal(initial.revision, 0);
  const saved = await store.saveConfig({
    revision: 0,
    values: { modelId: "local-model", baseUrl: "http://127.0.0.1:1234/v1" },
    apiKey: "test-secret",
  });
  assert.equal(saved.apiKeyConfigured, true);
  assert.ok(!JSON.stringify(saved).includes("test-secret"));
  assert.equal((await stat(join(dir, ".env"))).mode & 0o777, 0o600);
  const before = await readFile(join(dir, ".env"), "utf8");
  await assert.rejects(
    store.saveConfig({
      revision: 1,
      values: { maxTokens: "999999" },
      apiKey: "replacement",
    }),
    /cannot exceed/,
  );
  assert.equal(await readFile(join(dir, ".env"), "utf8"), before);
  await assert.rejects(
    store.saveConfig({ revision: 0, values: {} }),
    /changed elsewhere/,
  );
  await assert.rejects(
    store.saveConfig({
      revision: 1,
      values: { baseUrl: "https://user:pass@example.com" },
    }),
    /without credentials/,
  );
  const preserved = await store.saveConfig({
    revision: 1,
    values: { language: "en" },
    apiKey: "",
  });
  assert.equal(preserved.apiKeyConfigured, true);
  assert.equal((await store.privateConfig()).apiKey, "test-secret");
  const next = await new Store(dir).config();
  assert.equal(next.values.language, "en");
  await store.saveConfig({
    revision: next.revision,
    values: {},
    clearApiKey: true,
  });
  assert.equal((await store.config()).apiKeyConfigured, false);
});
test("concurrent edits detect conflicts rather than lose updates", async (t) => {
  const { store } = await fixture(t);
  const result = await Promise.allSettled([
    store.saveConfig({ revision: 0, values: { modelId: "one" } }),
    store.saveConfig({ revision: 0, values: { modelId: "two" } }),
  ]);
  assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await store.config()).revision, 1);
});
test("projects persist independently, support rename and notes, and reject stale edits", async (t) => {
  const { dir, store } = await fixture(t);
  const one = await store.createProject({ name: "First" }),
    two = await store.createProject({ name: "Second" });
  const edited = await store.updateProject(one.id, {
    updatedAt: one.updatedAt,
    name: "Renamed",
    notes: "A new direction",
  });
  await assert.rejects(
    store.updateProject(one.id, {
      updatedAt: one.updatedAt,
      notes: "Stale draft",
    }),
    /changed elsewhere/,
  );
  const projects = await new Store(dir).projects();
  assert.equal(projects.find((p) => p.id === one.id).notes, "A new direction");
  assert.equal(projects.find((p) => p.id === two.id).notes, "");
  assert.equal(edited.name, "Renamed");
  await assert.rejects(store.updateProject("missing", {}), /not found/);
  await assert.rejects(store.createProject({ name: "   " }), /1–120/);
});
test("Pi 1.3 SDK initializes without tools or ambient instructions, without model calls", async (t) => {
  const { dir } = await fixture(t);
  await writeFile(
    join(dir, "AGENTS.md"),
    "Ambient project instructions must not load.",
  );
  await mkdir(join(dir, ".pi"), { recursive: true });
  const { session } = await createHarnessSession({
    cwd: dir,
    agentDir: join(dir, "pi"),
    values: {
      ...defaults,
      modelId: "offline-fixture",
      baseUrl: "http://127.0.0.1:1/v1",
    },
    apiKey: "",
    systemPrompt: "Explicit fixture instructions.",
  });
  try {
    assert.deepEqual(session.getActiveToolNames(), []);
    assert.equal(session.model.id, "offline-fixture");
    assert.ok(session.systemPrompt.includes("Explicit fixture instructions."));
    assert.ok(!session.systemPrompt.includes("Ambient project instructions"));
    assert.equal(session.messages.length, 0);
  } finally {
    session.dispose();
  }
});
test("HTTP API rejects cross-site writes, redacts secrets, and serves the built UI", async (t) => {
  const { dir, store } = await fixture(t);
  const web = join(dir, "web");
  await mkdir(web);
  await writeFile(join(web, "index.html"), "<html>Harness</html>");
  const app = createApp(store, web);
  await new Promise((resolve, reject) => {
    app.once("error", reject);
    app.listen(0, "127.0.0.1", resolve);
  });
  t.after(
    () =>
      new Promise((resolve) => {
        app.close(resolve);
        app.closeAllConnections();
      }),
  );
  const base = `http://127.0.0.1:${app.address().port}`;
  const send = (path, body, extra = {}, method = "POST") =>
    fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", ...extra },
      body: JSON.stringify(body),
    });
  assert.equal((await fetch(base + "/api/health")).status, 200);
  assert.equal(
    (
      await send(
        "/api/projects",
        { name: "Blocked" },
        { Origin: "https://example.com" },
      )
    ).status,
    403,
  );
  const reboundStatus = await new Promise((resolve, reject) => {
    const req = httpRequest(
      base + "/api/config",
      { headers: { Host: "attacker.example:4311" } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(reboundStatus, 403);
  assert.equal(
    (
      await send(
        "/api/config",
        { revision: 0, values: {}, apiKey: "hidden-http-secret" },
        {},
        "PUT",
      )
    ).status,
    200,
  );
  const config = await (await fetch(base + "/api/config")).text();
  assert.ok(!config.includes("hidden-http-secret"));
  const created = await send("/api/projects", { name: "HTTP project" });
  assert.equal(created.status, 201);
  assert.equal((await (await fetch(base + "/api/projects")).json()).length, 1);
  assert.equal(
    (await send("/api/projects", { name: "x".repeat(1048577) })).status,
    413,
  );
  assert.equal((await fetch(base + "/missing.js")).status, 404);
  assert.ok((await (await fetch(base)).text()).includes("Harness"));
  assert.equal((await fetch(base + "/api/unknown")).status, 404);
});

test("root env configuration migrates legacy settings once and keeps unrelated variables", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "make-env-migration-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const data = join(root, "data");
  await mkdir(data);
  await writeFile(join(data, "config.json"), JSON.stringify({
    revision: 7, values: { modelId: "migrated" }, apiKey: "legacy-key", searchApiKey: "search-key",
  }));
  const store = new Store(data, join(root, ".env"));
  await store.init();
  assert.equal((await store.config()).revision, 7);
  assert.equal((await store.privateConfig()).apiKey, "legacy-key");
  assert.equal((await store.privateConfig()).searchApiKey, "search-key");
  await assert.rejects(stat(join(data, "config.json")), { code: "ENOENT" });
  assert.equal((await stat(join(root, ".env"))).mode & 0o777, 0o600);
  await writeFile(join(root, ".env"), (await readFile(join(root, ".env"), "utf8")) + '# Custom startup settings\nPORT=4321\nEXTRA="keep me"\n');
  const specialKey = 'key#with"quotes\'and\\slashes$';
  await store.saveConfig({ revision: 7, values: { providerName: 'Provider "A" #1' }, apiKey: specialKey });
  assert.equal((await store.privateConfig()).apiKey, specialKey);
  const text = await readFile(join(root, ".env"), "utf8");
  assert.ok(text.includes('# Custom startup settings\nPORT=4321\nEXTRA="keep me"'));
  assert.ok(!JSON.stringify(await store.config()).includes(specialKey));
  await writeFile(join(data, "config.json"), JSON.stringify({ revision: 99, values: {}, apiKey: "stale" }));
  await new Store(data, join(root, ".env")).init();
  assert.equal((await store.privateConfig()).apiKey, specialKey);
});

test("manually edited dotenv values are loaded and validated without exposing secrets", async (t) => {
  const { dir, store } = await fixture(t);
  await writeFile(join(dir, ".env"), '# Manual settings\nMAKE_MODEL_ID=local-model\nMAKE_PROVIDER_NAME="Local provider" # comment\nMAKE_API_KEY=secret#comment\nMAKE_LANGUAGE=en\n');
  assert.equal((await store.config()).values.modelId, "local-model");
  assert.equal((await store.config()).values.providerName, "Local provider");
  assert.equal((await store.privateConfig()).apiKey, "secret");
  await writeFile(join(dir, ".env"), 'MAKE_MAX_TOKENS=invalid\n');
  await assert.rejects(store.config(), /Out of range/);
});

test("project rename moves legacy directories and deletion removes only the selected project through API", async (t) => {
  const { dir, store } = await fixture(t);
  const { DesignStore } = await import("../dist/design-store.js");
  const design = new DesignStore(store);
  const project = await store.createProject({ name: "Original" });
  const other = await store.createProject({ name: "Keep" });
  const artifact = await design.artifact(project.id, "product", { name: "notes.md", content: "Keep these bytes", kind: "document", mediaType: "text/markdown" });
  const before = await design.read(project.id);
  // Simulate the UUID-only directory layout from earlier versions.
  const { rename } = await import("node:fs/promises");
  await rename(store.projectPath(project), join(store.workspaceDir, project.id));
  const legacy = { ...project };
  delete legacy.directory;
  await writeFile(join(store.workspaceDir, "projects.json"), JSON.stringify([legacy, other]));
  const app = createApp(store, undefined, { design });
  await new Promise(resolve => app.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { app.close(resolve); app.closeAllConnections(); }));
  const base = `http://127.0.0.1:${app.address().port}/api/projects/${project.id}`;
  const send = (method, body) => fetch(base, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const response = await send("PATCH", { name: "新项目 / ../Prototype", updatedAt: project.updatedAt });
  assert.equal(response.status, 200);
  const renamed = await response.json();
  assert.ok(renamed.directory.startsWith("新项目-Prototype-"));
  assert.equal(renamed.id, project.id);
  await assert.rejects(stat(join(store.workspaceDir, project.id)), { code: "ENOENT" });
  assert.deepEqual(await design.read(project.id), before);
  assert.equal((await design.artifactContent(project.id, artifact.id)).content.toString(), "Keep these bytes");
  assert.equal((await send("DELETE", { updatedAt: project.updatedAt })).status, 409);
  assert.equal((await send("DELETE", { updatedAt: renamed.updatedAt })).status, 200);
  await assert.rejects(stat(store.projectPath(renamed)), { code: "ENOENT" });
  assert.equal((await fetch(`${base}/design`)).status, 404);
  assert.equal((await send("DELETE", { updatedAt: renamed.updatedAt })).status, 404);
  assert.equal((await store.projects()).length, 1);
  await stat(store.projectPath(other));
  await stat(join(dir, ".env"));
});

test("project mutations wait for Context writes and reject projects with active runs", async (t) => {
  const { store } = await fixture(t);
  const { DesignStore } = await import("../dist/design-store.js");
  const design = new DesignStore(store);
  const project = await store.createProject({ name: "Busy project" });
  let unblock, entered;
  const gate = new Promise(resolve => { unblock = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const writing = design.change(project.id, async saved => {
    entered(); await gate;
    saved.runs.push({ id: "active-test", status: "running" });
  });
  await started;
  let mutationEntered = false;
  const deletion = design.exclusive(project.id, async () => {
    mutationEntered = true;
    return store.deleteProject(project.id, { updatedAt: project.updatedAt });
  });
  assert.equal(mutationEntered, false);
  unblock();
  await writing;
  await assert.rejects(deletion, /Stop active runs and image jobs/);
  await assert.rejects(store.updateProject(project.id, { name: "New name", updatedAt: project.updatedAt }), /Stop active runs and image jobs/);
  await stat(store.projectPath(project));
  await design.change(project.id, saved => { saved.runs[0].status = "stopped"; });
  const renamed = await design.exclusive(project.id, () => store.updateProject(project.id, { name: "Now idle", updatedAt: project.updatedAt }));
  assert.equal(renamed.name, "Now idle");
});

test("workspace migration preserves project bytes and separates configurable workspaces", async (t) => {
  const { dir, store } = await fixture(t);
  const legacyProject = { id: "abc-123", name: "Legacy", notes: "Original notes", createdAt: "2026-01-01", updatedAt: "2026-01-01" };
  const legacy = join(dir, "design", legacyProject.id);
  await mkdir(join(legacy, "artifacts"), { recursive: true });
  await writeFile(join(legacy, "design.json"), '{"context":{"entries":[]},"runs":[]}');
  await writeFile(join(legacy, "artifacts", "binary"), Buffer.from([0, 255, 17]));
  await writeFile(join(dir, "projects.json"), JSON.stringify([legacyProject]));
  const workspace = join(dir, "custom-workspace");
  const migrated = new Store(dir, store.configFile, workspace);
  await migrated.init();
  assert.equal((await migrated.config()).workspaceDir, workspace);
  assert.deepEqual(await migrated.projects(), [legacyProject]);
  assert.deepEqual(await readFile(join(workspace, legacyProject.id, "artifacts", "binary")), Buffer.from([0, 255, 17]));
  await assert.rejects(stat(legacy), { code: "ENOENT" });
  await assert.rejects(stat(join(dir, "projects.json")), { code: "ENOENT" });
  await migrated.init();
  assert.equal((await migrated.projects()).length, 1);
  const separate = new Store(dir, store.configFile, join(dir, "another-workspace"));
  await separate.init();
  assert.deepEqual(await separate.projects(), []);
  const created = await separate.createProject({ name: "Independent" });
  await stat(separate.projectPath(created));
  assert.equal((await migrated.projects()).length, 1);
});

test("workspace migration rejects conflicting destinations and retains all original files", async (t) => {
  const { dir, store } = await fixture(t);
  const project = { id: "abc-456", name: "Conflict" };
  await mkdir(join(dir, "design", project.id), { recursive: true });
  await writeFile(join(dir, "design", project.id, "source.txt"), "original");
  await writeFile(join(dir, "projects.json"), JSON.stringify([project]));
  const workspace = join(dir, "conflicting-workspace");
  await mkdir(join(workspace, project.id), { recursive: true });
  await writeFile(join(workspace, project.id, "source.txt"), "different");
  await assert.rejects(new Store(dir, store.configFile, workspace).init(), /conflicts/);
  assert.equal(await readFile(join(dir, "design", project.id, "source.txt"), "utf8"), "original");
  await stat(join(dir, "projects.json"));
  await assert.rejects(stat(join(workspace, "projects.json")), { code: "ENOENT" });
});

test("workspace settings persist in env, preserve active projects, and apply after restart", async (t) => {
  const { dir, store } = await fixture(t);
  const project = await store.createProject({ name: "Remain active" });
  const target = join(dir, 'new workspace #1 "quoted"');
  const saved = await store.saveConfig({ revision: 0, values: {}, workspaceDir: target });
  assert.equal(saved.workspaceDir, store.workspaceDir);
  assert.equal(saved.configuredWorkspaceDir, target);
  assert.equal(saved.workspaceRestartRequired, true);
  assert.equal((await store.projects())[0].id, project.id);
  assert.equal((await store.privateConfig()).workspaceDir, target);
  const again = await store.saveConfig({ revision: 1, values: { language: "en" } });
  assert.equal(again.configuredWorkspaceDir, target);
  const restarted = new Store(dir, store.configFile, (await store.privateConfig()).workspaceDir);
  await restarted.init();
  assert.equal((await restarted.config()).workspaceRestartRequired, false);
  assert.deepEqual(await restarted.projects(), []);
  await stat(store.projectPath(project));
  const before = await readFile(store.configFile, "utf8");
  await assert.rejects(store.saveConfig({ revision: 2, values: {}, workspaceDir: "" }), /valid workspace/);
  await assert.rejects(store.saveConfig({ revision: 2, values: {}, workspaceDir: dir }), /separate/);
  await assert.rejects(store.saveConfig({ revision: 2, values: {}, workspaceDir: join(dir, "design") }), /separate/);
  assert.equal(await readFile(store.configFile, "utf8"), before);
  const relative = await store.saveConfig({ revision: 2, values: {}, workspaceDir: "relative workspace" });
  assert.equal(relative.configuredWorkspaceDir, join(dir, "relative workspace"));
});

test("public requests and resumed specialist runs always enter through the orchestrator", async (t) => {
  const { store } = await fixture(t);
  const { DesignStore } = await import("../dist/design-store.js");
  const design = new DesignStore(store);
  const project = await store.createProject({ name: "Automatic routing" });
  await design.change(project.id, saved => {
    saved.runs.push({ id: "abc-123", role: "mechanical", prompt: "Adjust the enclosure", status: "stopped" });
  });
  const calls = [];
  const runtime = { start: async (id, input) => { calls.push({ id, ...input }); return { id: "new-run", ...input }; } };
  const app = createApp(store, undefined, { design, runtime });
  await new Promise(resolve => app.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { app.close(resolve); app.closeAllConnections(); }));
  const base = `http://127.0.0.1:${app.address().port}/api/projects/${project.id}/runs`;
  const post = (path, input) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  assert.equal((await post("", { prompt: "Build my prototype" })).status, 202);
  assert.equal((await post("", { prompt: "Fix this part", role: "mechanical" })).status, 202);
  assert.equal((await post("/abc-123/resume", {})).status, 202);
  assert.deepEqual(calls.map(call => call.role), ["orchestrator", "orchestrator", "orchestrator"]);
  assert.equal(calls[2].resumedFrom, "abc-123");
  assert.equal(calls[2].prompt, "Adjust the enclosure");
});

test("search defaults to Serper and keeps provider credentials isolated across switches", async (t) => {
  const { store } = await fixture(t);
  assert.equal((await store.config()).values.searchProvider, "serper");
  let config = await store.saveConfig({ revision: 0, values: {}, searchApiKey: "serper-test-secret" });
  assert.equal(config.searchApiKeyConfigured, true);
  assert.deepEqual(config.searchKeysConfigured, { serper: true, brave: false });
  config = await store.saveConfig({ revision: 1, values: { searchProvider: "brave" } });
  assert.equal(config.searchApiKeyConfigured, false);
  config = await store.saveConfig({ revision: 2, values: {}, searchApiKey: "brave-test-secret" });
  assert.equal(config.searchApiKeyConfigured, true);
  assert.equal((await store.privateConfig()).serperApiKey, "serper-test-secret");
  assert.equal((await store.privateConfig()).searchApiKey, "brave-test-secret");
  config = await store.saveConfig({ revision: 3, values: { searchProvider: "serper" }, clearSearchApiKey: true });
  assert.equal(config.searchApiKeyConfigured, false);
  assert.equal(config.searchKeysConfigured.brave, true);
  assert.equal((await store.privateConfig()).searchApiKey, "brave-test-secret");
  const env = await readFile(store.configFile, "utf8");
  assert.ok(env.includes('MAKE_SEARCH_PROVIDER="serper"'));
  assert.ok(env.includes('SERPER_API_KEY=""'));
  assert.ok(!JSON.stringify(config).includes("test-secret"));
  await assert.rejects(store.saveConfig({ revision: 4, values: { searchProvider: "unknown" } }), /Unsupported option/);
});
