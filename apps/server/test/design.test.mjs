import test from "node:test";
import { PhotonImage } from "@silvia-odwyer/photon-node";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { Store } from "../dist/store.js";
import { DesignStore } from "../dist/design-store.js";
import { AgentRuntime } from "../dist/agents/runtime.js";
import { contextSlice } from "../dist/context-view.js";
import { generateCAD } from "../dist/cad.js";
import { publicFetch, publicIPv4 } from "../dist/web.js";
import { projectZip } from "../dist/export.js";
import { createApp } from "../dist/app.js";
import { ROLES } from "@harness/core";
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "make-system-")),
    store = new Store(dir);
  await store.init();
  const project = await store.createProject({ name: "Prototype fixture" }),
    design = new DesignStore(store);
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, store, project, design };
}
const patch = (id, extra = {}) => ({
  id,
  owner: "product",
  baseRevision: 0,
  title: id,
  content: "fixture",
  data: {},
  dependsOn: [],
  artifactIds: [],
  status: "ready",
  reason: "test change",
  ...extra,
});
async function call(options, name, params = {}) {
  const tool = options.tools.find((tool) => tool.name === name);
  assert.ok(tool, `${name} available to ${options.role}`);
  const result = await tool.execute(
    "fixture-tool",
    params,
    options.signal,
    () => {},
    {},
  );
  const data = JSON.parse(result.content[0].text);
  assert.ok(
    !result.isError,
    typeof data === "string" ? data : JSON.stringify(data),
  );
  return data;
}
const params = (input) => {
  const { data, owner, ...rest } = input;
  return { ...rest, dataJson: JSON.stringify(data) };
};
async function configured(store, url = "http://127.0.0.1:1/v1") {
  await store.saveConfig({
    revision: 0,
    values: { baseUrl: url, modelId: "offline-fixture" },
    apiKey: "mock-secret-do-not-export",
  });
}
async function listen(t, server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  return `http://127.0.0.1:${server.address().port}`;
}

test("Context enforces ownership, read revisions, valid references and acyclic dependencies atomically", async (t) => {
  const { project, design } = await fixture(t),
    id = project.id;
  await design.patch(id, "product", patch("product.requirements"));
  const before = await design.read(id);
  await assert.rejects(
    design.patch(
      id,
      "hardware",
      patch("product.requirements", { baseRevision: 1 }),
      { "product.requirements": 1 },
    ),
    /Only the owner/,
  );
  await assert.rejects(
    design.patch(
      id,
      "product",
      patch("product.requirements", { baseRevision: 1 }),
    ),
    /Read the current/,
  );
  await assert.rejects(
    design.patch(
      id,
      "user",
      patch("hardware.screen", { owner: "hardware", dependsOn: ["missing"] }),
    ),
    /Unknown/,
  );
  await assert.rejects(
    design.patch(
      id,
      "user",
      patch("hardware.screen", { owner: "hardware", artifactIds: ["missing"] }),
    ),
    /Unknown artifact/,
  );
  assert.deepEqual(await design.read(id), before);
  await design.patch(
    id,
    "hardware",
    patch("hardware.screen", { dependsOn: ["product.requirements"] }),
    { "product.requirements": 1 },
  );
  await assert.rejects(
    design.patch(
      id,
      "user",
      patch("product.requirements", {
        baseRevision: 1,
        dependsOn: ["hardware.screen"],
      }),
    ),
    /cycle/,
  );
  await design.patch(
    id,
    "user",
    patch("product.requirements", { baseRevision: 1, content: "changed" }),
  );
  await assert.rejects(
    design.patch(id, "hardware", patch("hardware.second"), {
      "product.requirements": 1,
    }),
    /Input changed/,
  );
});
test("upstream changes invalidate transitive dependents and their revisions, preserving unrelated entries", async (t) => {
  const { project, design, store } = await fixture(t),
    id = project.id;
  await design.patch(
    id,
    "user",
    patch("hardware.screen", { owner: "hardware" }),
  );
  await design.patch(
    id,
    "user",
    patch("mechanical.case", {
      owner: "mechanical",
      dependsOn: ["hardware.screen"],
    }),
  );
  await design.patch(
    id,
    "user",
    patch("documentation.guide", {
      owner: "documentation",
      dependsOn: ["mechanical.case"],
    }),
  );
  await design.patch(id, "user", patch("product.unrelated"));
  const changed = await design.patch(
    id,
    "user",
    patch("hardware.screen", {
      owner: "hardware",
      baseRevision: 1,
      content: "new dimensions",
    }),
  );
  assert.deepEqual(changed.invalidated, [
    "mechanical.case",
    "documentation.guide",
  ]);
  const entries = (await new DesignStore(store).read(id)).context.entries;
  assert.equal(
    entries.find((entry) => entry.id === "mechanical.case").revision,
    2,
  );
  assert.equal(
    entries.find((entry) => entry.id === "documentation.guide").status,
    "needs_review",
  );
  assert.equal(
    entries.find((entry) => entry.id === "product.unrelated").revision,
    1,
  );
  assert.equal(
    entries.find((entry) => entry.id === "product.unrelated").status,
    "ready",
  );
});
test("targeted Context reads omit unrelated full content and return relevant changes", async (t) => {
  const { project, design } = await fixture(t),
    id = project.id;
  await design.patch(id, "user", patch("product.requirements"));
  await design.patch(
    id,
    "user",
    patch("hardware.screen", {
      owner: "hardware",
      dependsOn: ["product.requirements"],
    }),
  );
  await design.patch(
    id,
    "user",
    patch("firmware.large", {
      owner: "firmware",
      content: "UNRELATED-FIRMWARE".repeat(300),
    }),
  );
  const view = contextSlice(await design.read(id), "hardware");
  assert.deepEqual(
    view.entries.map((entry) => entry.id).sort(),
    ["hardware.screen", "product.requirements"].sort(),
  );
  assert.ok(!JSON.stringify(view).includes("UNRELATED-FIRMWARE"));
  assert.equal(view.changes.length, 2);
});
test("parametric CSG makes real bounded STL geometry and rejects invalid or excessive recipes", () => {
  const recipe = {
    parameters: { width: 60 },
    geometry: {
      op: "subtract",
      children: [
        { op: "box", size: ["$width", 40, 20] },
        {
          op: "translate",
          value: [0, 0, 2],
          child: { op: "box", size: [56, 36, 20] },
        },
      ],
    },
  };
  const result = generateCAD(recipe);
  assert.ok(result.stl.includes("facet normal"));
  assert.ok(result.scad.includes("difference()"));
  assert.equal(result.report.units, "mm");
  assert.ok(result.report.volumeMm3 > 0 && result.report.volumeMm3 < 48000);
  assert.throws(
    () => generateCAD({ geometry: { op: "box", size: [0, 2, 3] } }),
    /dimension/,
  );
  assert.throws(
    () => generateCAD({ geometry: { op: "execute", code: "dangerous" } }),
    /Unsupported/,
  );
  assert.throws(
    () =>
      generateCAD({
        geometry: { op: "cylinder", height: 2, radius: 3, segments: 10000 },
      }),
    /12–64/,
  );
});
test("all seven roles coordinate through real Context and artifact tools (offline deterministic driver)", async (t) => {
  const { project, design, store } = await fixture(t);
  await configured(store);
  const visited = [];
  const driver = async (options) => {
    visited.push(options.role);
    if (options.role === "orchestrator") {
      for (const role of ROLES.filter((role) => role.id !== "orchestrator"))
        await call(options, "delegate_task", {
          role: role.id,
          instruction: `Implement ${role.id} fixture`,
          contextIds: [],
        });
      await call(options, "context_read", {
        ids: ROLES.filter((role) => role.id !== "orchestrator").map(
          (role) => `${role.id}.fixture`,
        ),
      });
      await call(
        options,
        "context_update",
        params(
          patch("orchestrator.fixture", {
            owner: "orchestrator",
            dependsOn: [
              "product.fixture",
              "hardware.fixture",
              "mechanical.fixture",
              "firmware.fixture",
              "validation.fixture",
              "documentation.fixture",
            ],
          }),
        ),
      );
    } else {
      const dependencies =
        options.role === "product" ? [] : ["product.fixture"];
      await call(options, "context_read", { ids: dependencies });
      let artifactIds = [];
      if (options.role === "mechanical") {
        const model = await call(options, "cad_generate", {
          name: "bracket",
          recipeJson: JSON.stringify({
            geometry: { op: "box", size: [40, 30, 2] },
          }),
        });
        artifactIds = [
          model.mesh.id,
          model.source.id,
          model.recipe.id,
          model.report.id,
        ];
      } else if (["firmware", "documentation"].includes(options.role)) {
        const file = await call(options, "artifact_write", {
          name: options.role === "firmware" ? "main.ino" : "assembly-guide.md",
          content:
            options.role === "firmware"
              ? "void setup() {}\nvoid loop() {}"
              : "# Assembly\nPhysical test pending.",
          kind: options.role === "firmware" ? "firmware" : "document",
        });
        artifactIds = [file.id];
      }
      await call(
        options,
        "context_update",
        params(
          patch(`${options.role}.fixture`, {
            owner: options.role,
            dependsOn: dependencies,
            artifactIds,
            data:
              options.role === "hardware"
                ? { kind: "component", model: "fixture-board", quantity: 1 }
                : {},
          }),
        ),
      );
    }
    return `${options.role}: saved actual fixture output`;
  };
  const runtime = new AgentRuntime(design, driver),
    run = await runtime.start(project.id, {
      prompt: "Build the offline fixture",
    });
  await runtime.wait(run.id);
  const state = await design.read(project.id),
    saved = state.runs[0];
  assert.equal(saved.status, "completed", saved.error);
  assert.equal(new Set(visited).size, 7);
  assert.equal(saved.tasks.length, 7);
  assert.equal(state.context.entries.length, 7);
  assert.ok(
    state.context.artifacts.some((artifact) => artifact.kind === "mesh"),
  );
  assert.ok(saved.events.some((event) => event.type === "context"));
  assert.ok(!JSON.stringify(state).includes("mock-secret-do-not-export"));
});
test("user questions are durable and mark a run awaiting_input", async (t) => {
  const { project, design, store } = await fixture(t);
  await configured(store);
  const runtime = new AgentRuntime(design, async (options) => {
    await call(options, "request_input", {
      question: "What printer and maximum budget are available?",
    });
    return "Please provide the printer and budget.";
  });
  const run = await runtime.start(project.id, {
    prompt: "Design a prototype",
    role: "product",
  });
  await runtime.wait(run.id);
  const state = await design.read(project.id);
  assert.equal(state.runs[0].status, "awaiting_input");
  assert.equal(state.context.entries.find(e => e.data.kind === "question")?.data.kind, "question");
});
test("stopping and restart recovery retain Context and permit explicit continuation", async (t) => {
  const { project, design, store } = await fixture(t);
  await configured(store);
  let entered;
  const ready = new Promise((resolve) => (entered = resolve));
  const runtime = new AgentRuntime(design, async (options) => {
    await call(options, "context_update", params(patch("product.saved")));
    entered();
    await new Promise((resolve, reject) =>
      options.signal.addEventListener(
        "abort",
        () => reject(new Error("cancelled")),
        { once: true },
      ),
    );
    return "unreachable";
  });
  const run = await runtime.start(project.id, {
    prompt: "long task",
    role: "product",
  });
  await ready;
  await assert.rejects(
    runtime.start(project.id, { prompt: "duplicate", role: "product" }),
    /active run/,
  );
  await runtime.stop(project.id, run.id);
  await runtime.wait(run.id);
  assert.equal((await design.read(project.id)).runs[0].status, "stopped");
  assert.equal((await design.read(project.id)).context.entries.length, 1);
  await design.change(project.id, (state) => {
    state.runs[0].status = "running";
    state.runs[0].tasks[0].status = "running";
  });
  await new DesignStore(store).recover();
  assert.equal((await design.read(project.id)).runs[0].status, "interrupted");
  const resumed = new AgentRuntime(design, async (options) => {
    assert.ok(options.prompt.includes("Previous saved work"));
    await call(options, "context_read", { ids: ["product.saved"] });
    await call(
      options,
      "context_update",
      params(patch("product.saved", { baseRevision: 1, content: "continued" })),
    );
    return "Resumed";
  });
  const next = await resumed.start(project.id, {
    prompt: "continue",
    role: "product",
    resumedFrom: run.id,
  });
  await resumed.wait(next.id);
  assert.equal((await design.read(project.id)).context.entries[0].revision, 2);
});
function unzip(buffer) {
  const entries = {};
  let offset = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  while (offset >= 0 && buffer.readUInt32LE(offset) === 0x02014b50) {
    const method = buffer.readUInt16LE(offset + 10),
      size = buffer.readUInt32LE(offset + 20),
      nameLength = buffer.readUInt16LE(offset + 28),
      extra = buffer.readUInt16LE(offset + 30),
      comment = buffer.readUInt16LE(offset + 32),
      local = buffer.readUInt32LE(offset + 42),
      name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString();
    const start =
        local +
        30 +
        buffer.readUInt16LE(local + 26) +
        buffer.readUInt16LE(local + 28),
      bytes = buffer.subarray(start, start + size);
    entries[name] = method === 8 ? inflateRawSync(bytes) : bytes;
    offset += 46 + nameLength + extra + comment;
  }
  return entries;
}
test("ZIP export binds artifact hashes and excludes credentials, Pi sessions and private settings", async (t) => {
  const { project, design, store } = await fixture(t);
  await configured(store);
  const artifact = await design.artifact(project.id, "documentation", {
    name: "guide.md",
    content: "# Assembly",
    kind: "document",
    mediaType: "text/markdown",
  });
  await design.patch(
    project.id,
    "user",
    patch("documentation.guide", {
      owner: "documentation",
      artifactIds: [artifact.id],
    }),
  );
  const { zip } = await projectZip(design, project.id),
    chunks = [];
  const done = new Promise((resolve, reject) => {
    zip.outputStream.on("data", (chunk) => chunks.push(chunk));
    zip.outputStream.on("end", resolve);
    zip.outputStream.on("error", reject);
  });
  zip.end();
  await done;
  const files = unzip(Buffer.concat(chunks));
  assert.ok(files["design-context.json"]);
  assert.ok(Object.keys(files).some((path) => path.endsWith("/guide.md")));
  assert.ok(
    !Object.values(files).some((bytes) =>
      bytes.toString().includes("mock-secret-do-not-export"),
    ),
  );
  assert.ok(
    !Object.keys(files).some((path) => /auth|sessions|config.json/.test(path)),
  );
  await writeFile(
    join(await design.projectDir(project.id), "artifacts", artifact.id),
    "tampered",
  );
  await assert.rejects(projectZip(design, project.id), /integrity/);
});
test("web tools reject loopback and local network sources before fetching", async () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "::1",
    "::ffff:127.0.0.1",
  ])
    assert.equal(publicIPv4(address), false);
  assert.equal(publicIPv4("8.8.8.8"), true);
  await assert.rejects(publicFetch("http://127.0.0.1/private"), /Private/);
  await assert.rejects(publicFetch("file:///etc/passwd"), /HTTP/);
});
test("project API isolates artifacts, reports missing configuration, and offers real downloads", async (t) => {
  const { project, design, store } = await fixture(t),
    other = await store.createProject({ name: "Other" });
  const runtime = new AgentRuntime(design, async () => {
    throw new Error("must not run without config");
  });
  const base = await listen(
    t,
    createApp(store, undefined, { design, runtime }),
  );
  const post = (url, body) =>
    fetch(base + url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  assert.equal(
    (await (await fetch(base + "/api/agents")).json()).agents.length,
    7,
  );
  assert.equal(
    (await post(`/api/projects/${project.id}/runs`, { prompt: "test" })).status,
    400,
  );
  const file = await design.artifact(project.id, "documentation", {
    name: "guide.md",
    content: "# Guide",
    kind: "document",
    mediaType: "text/plain",
  });
  assert.equal(
    (await fetch(`${base}/api/projects/${other.id}/artifacts/${file.id}`))
      .status,
    404,
  );
  const download = await fetch(
    `${base}/api/projects/${project.id}/artifacts/${file.id}`,
  );
  assert.match(download.headers.get("content-disposition"), /attachment/);
  assert.equal(await download.text(), "# Guide");
  const exported = await fetch(`${base}/api/projects/${project.id}/export`);
  assert.equal(exported.status, 200);
  assert.ok(
    unzip(Buffer.from(await exported.arrayBuffer()))["artifact-manifest.json"],
  );
});
test("real Pi session executes CAD and Context tools through a local mock OpenAI stream, without paid models", async (t) => {
  const { project, design, store } = await fixture(t);
  let requests = 0;
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (req.url === "/v1/images/generations") {
      const image = new PhotonImage(new Uint8Array(4 * 4 * 4).fill(255), 4, 4);
      const bytes = image.get_bytes();image.free();
      res.writeHead(200, {"Content-Type": "application/json"});res.end(JSON.stringify({data:[{b64_json:Buffer.from(bytes).toString("base64")}]}));return;
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(req.headers.authorization, "Bearer mock-secret-do-not-export");
    let tool;
    if (requests === 0)
      tool = {
        name: "use_skill",
        arguments: JSON.stringify({
          name: "make-parametric-cad",
          rationale:
            "Generate a plate with editable CSG and record geometric checks",
        }),
      };
    if (requests === 1)
      tool = {
        name: "cad_generate",
        arguments: JSON.stringify({
          name: "pi_plate",
          recipeJson: JSON.stringify({
            geometry: { op: "box", size: [20, 30, 2] },
          }),
        }),
      };
    if (requests === 2) {
      const result = JSON.parse(
        payload.messages.filter((message) => message.role === "tool").at(-1)
          .content,
      );
      tool = {
        name: "context_update",
        arguments: JSON.stringify(
          params(
            patch("mechanical.pi", {
              owner: "mechanical",
              artifactIds: [
                result.mesh.id,
                result.recipe.id,
                result.source.id,
                result.report.id,
              ],
            }),
          ),
        ),
      };
    }
    requests++;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const chunk = (delta) =>
      res.write(
        `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "offline-fixture", choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`,
      );
    chunk(
      tool
        ? {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: `call_${requests}`,
                type: "function",
                function: tool,
              },
            ],
          }
        : {
            role: "assistant",
            content:
              "Saved the plate CAD and Context. Physical checks pending.",
          },
    );
    res.write(
      `data: ${JSON.stringify({ id: "fixture", choices: [{ index: 0, delta: {}, finish_reason: tool ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`,
    );
    res.end();
  });
  const base = await listen(t, server);
  await configured(store, base + "/v1");
  const runtime = new AgentRuntime(design);
  await store.saveConfig({revision: (await store.config()).revision, values:{imageBaseUrl:base+"/v1",imageModel:"offline-image"}});
  const concept = await runtime.appearance.request(project.id, {title:"Plate concept",description:"A flat plate",prompt:"A flat rectangular plate",contextIds:[]});
  await runtime.appearance.wait(concept.id);
  const ready = (await design.read(project.id)).context.entries.find(e=>e.id===concept.id);
  const gate = (await design.read(project.id)).context.entries.find(e=>e.id==="appearance.review");
  await runtime.appearance.confirm(project.id,{optionId:ready.id,revision:ready.revision,gateRevision:gate.revision});
  const run = await runtime.start(project.id, {
      prompt: "Generate a plate and save its Context.",
      role: "mechanical",
    });
  await runtime.wait(run.id);
  const state = await design.read(project.id);
  assert.equal(state.runs[0].status, "completed", state.runs[0].error);
  assert.equal(requests, 4);
  assert.equal(
    state.runs[0].tasks[0].knowledge.skills[0].name,
    "make-parametric-cad",
  );
  assert.equal(
    state.context.entries.find(e=>e.id==="mechanical.pi")?.id,
    "mechanical.pi",
    JSON.stringify(state.runs[0].events),
  );
  assert.equal(state.context.artifacts.length, 6);
});

test("firmware paths reconstruct a usable current tree and conflicting referenced versions block ambiguous export", async (t) => {
  const { project, design } = await fixture(t);
  const source = await design.artifact(project.id, "firmware", {
    name: "src/main.cpp",
    content: "void setup() {}\nvoid loop() {}",
    kind: "firmware",
    mediaType: "text/plain",
  });
  const config = await design.artifact(project.id, "firmware", {
    name: "platformio.ini",
    content: "[env:fixture]\nboard=fixture",
    kind: "firmware",
    mediaType: "text/plain",
  });
  await design.patch(
    project.id,
    "user",
    patch("firmware.sources", {
      owner: "firmware",
      artifactIds: [source.id, config.id],
    }),
  );
  const { zip } = await projectZip(design, project.id),
    chunks = [];
  const done = new Promise((resolve, reject) => {
    zip.outputStream.on("data", (chunk) => chunks.push(chunk));
    zip.outputStream.on("end", resolve);
    zip.outputStream.on("error", reject);
  });
  zip.end();
  await done;
  const files = unzip(Buffer.concat(chunks));
  assert.equal(
    files["current/firmware/src/main.cpp"].toString(),
    "void setup() {}\nvoid loop() {}",
  );
  assert.ok(files["current/firmware/platformio.ini"]);
  for (const name of [
    "../escape.cpp",
    "/absolute.cpp",
    "src/../../escape.cpp",
    "src\\escape.cpp",
  ])
    await assert.rejects(
      design.artifact(project.id, "firmware", {
        name,
        content: "x",
        kind: "firmware",
        mediaType: "text/plain",
      }),
      /safe relative/,
    );
  const newer = await design.artifact(project.id, "firmware", {
    name: "src/main.cpp",
    content: "new version",
    kind: "firmware",
    mediaType: "text/plain",
  });
  await design.patch(
    project.id,
    "user",
    patch("firmware.other", { owner: "firmware", artifactIds: [newer.id] }),
  );
  await assert.rejects(
    projectZip(design, project.id),
    /Multiple currently referenced versions/,
  );
});

test("evidence upload persists a user observation without claiming physical verification", async (t) => {
  const { project, design, store } = await fixture(t);
  const base = await listen(t, createApp(store, undefined, { design }));
  const query = new URLSearchParams({
    name: "试配记录.txt",
    description: "测试条件：占位件；观察：尚未打印，本次仅检查上传功能。",
  });
  const response = await fetch(
    `${base}/api/projects/${project.id}/evidence?${query}`,
    {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "user supplied observation fixture",
    },
  );
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.entry.status, "draft");
  assert.equal(result.entry.updatedBy, "user");
  assert.equal(
    result.entry.data.validationStatus,
    "reported_not_independently_verified",
  );
  assert.equal(
    (
      await design.artifactContent(project.id, result.artifact.id)
    ).content.toString(),
    "user supplied observation fixture",
  );
  const invalid = await fetch(
    `${base}/api/projects/${project.id}/evidence?name=x.txt`,
    { method: "POST", headers: { "Content-Type": "text/plain" }, body: "x" },
  );
  assert.equal(invalid.status, 400);
});

test("new changes cannot silently replace ownership, accept stale output, or clear outstanding dependency review", async (t) => {
  const { project, design } = await fixture(t);
  await design.patch(
    project.id,
    "user",
    patch("hardware.screen", { owner: "hardware" }),
  );
  const mesh = await design.artifact(project.id, "mechanical", {
    name: "plate.stl",
    content: "fixture",
    kind: "mesh",
    mediaType: "model/stl",
    inputRevisions: { "hardware.screen": 1 },
  });
  await design.patch(
    project.id,
    "user",
    patch("mechanical.part", {
      owner: "mechanical",
      dependsOn: ["hardware.screen"],
      artifactIds: [mesh.id],
    }),
  );
  await design.patch(
    project.id,
    "user",
    patch("hardware.screen", {
      owner: "hardware",
      baseRevision: 1,
      content: "changed",
    }),
  );
  await assert.rejects(
    design.patch(
      project.id,
      "user",
      patch("mechanical.part", { owner: "hardware", baseRevision: 2 }),
    ),
    /owner cannot/,
  );
  await assert.rejects(
    design.patch(
      project.id,
      "user",
      patch("mechanical.part", {
        owner: "mechanical",
        baseRevision: 2,
        artifactIds: [mesh.id],
      }),
    ),
    /outdated/,
  );
  await assert.rejects(
    design.patch(
      project.id,
      "user",
      patch("documentation.final", {
        owner: "documentation",
        dependsOn: ["mechanical.part"],
      }),
    ),
    /needs review/,
  );
});

test("SSE emits project-scoped updates and closes subscriptions cleanly", async (t) => {
  const { project, design, store } = await fixture(t);
  const base = await listen(t, createApp(store, undefined, { design }));
  const abort = new AbortController(),
    response = await fetch(`${base}/api/projects/${project.id}/events`, {
      signal: abort.signal,
    });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  assert.ok(
    new TextDecoder().decode((await reader.read()).value).includes("changed"),
  );
  await design.patch(project.id, "user", patch("product.stream"));
  const update = await reader.read();
  assert.ok(new TextDecoder().decode(update.value).includes("changed"));
  abort.abort();
  await reader.cancel().catch(() => {});
});

test("pending questions accept options and durable user answers resume saved work through the orchestrator", async (t) => {
  const { project, design, store } = await fixture(t);
  await configured(store);
  let questionId;
  const driver = async options => {
    if (!options.prompt.includes('PLA on my printer')) {
      const result = await call(options, "request_input", { question: "Which material should we use?", options: ["PLA", "PETG"] });
      questionId = result.entryId;
      return "Please choose a material.";
    }
    assert.equal(options.role, "orchestrator");
    assert.ok(options.prompt.includes("Which material should we use?"));
    await call(options, "context_update", params({ ...patch("orchestrator.answer"), content: "Use PLA on the user's printer", data: { material: "PLA" } }));
    return "Continued with your material choice.";
  };
  const runtime = new AgentRuntime(design, driver);
  const original = await runtime.start(project.id, { prompt: "Build a prototype" });
  await runtime.wait(original.id);
  const question = (await design.read(project.id)).context.entries.find(entry => entry.id === questionId);
  assert.deepEqual(question.data.options, ["PLA", "PETG"]);
  const base = await listen(t, createApp(store, undefined, { design, runtime }));
  const answer = answers => fetch(`${base}/api/projects/${project.id}/runs/${original.id}/answer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers }) });
  assert.equal((await answer([])).status, 400);
  assert.equal((await answer([{ entryId: question.id, revision: question.revision + 1, answer: "PLA" }])).status, 409);
  const response = await answer([{ entryId: question.id, revision: question.revision, answer: "PLA on my printer" }]);
  assert.equal(response.status, 202);
  const resumed = await response.json();
  await runtime.wait(resumed.id);
  const saved = await design.read(project.id);
  const completed = saved.runs.find(run => run.id === resumed.id);
  assert.equal(completed.status, "completed", completed.error);
  assert.equal(completed.resumedFrom, original.id);
  assert.equal(completed.userAnswers[0].answer, "PLA on my printer");
  assert.equal((await answer([{ entryId: question.id, revision: question.revision, answer: "PETG" }])).status, 409);
});

test("question types preserve multi-select answers and reject invalid selections", async (t) => {
  const { project, design, store } = await fixture(t);
  await configured(store);
  const runtime = new AgentRuntime(design, async options => {
    await call(options, "request_input", { question: "Choose functions", options: ["Display", "Wi-Fi", "Logging"], inputType: "multiple" });
    await call(options, "request_input", { question: "Choose power", options: ["USB", "Battery"], inputType: "single" });
    await call(options, "request_input", { question: "Describe use", inputType: "text" });
    return "Waiting for decisions";
  });
  const original = await runtime.start(project.id, { prompt: "Define the device" });
  await runtime.wait(original.id);
  const snapshot = await design.read(project.id);
  const questions = snapshot.context.entries.filter(entry => entry.data.kind === "question");
  assert.deepEqual(questions.map(question => question.data.inputType), ["multiple", "single", "text"]);
  const answers = questions.map((question, index) => ({ entryId: question.id, revision: question.revision, answer: index === 0 ? "Display\nLogging\nStore locally" : index === 1 ? "USB" : "Indoor use", selectedOptions: index === 0 ? ["Display", "Logging"] : index === 1 ? ["USB"] : [] }));
  await assert.rejects(runtime.start(project.id, { prompt: "Continue", resumedFrom: original.id, userAnswers: answers.map((answer, index) => index === 0 ? { ...answer, selectedOptions: ["Unknown"] } : answer) }), /Invalid question option/);
  await assert.rejects(runtime.start(project.id, { prompt: "Continue", resumedFrom: original.id, userAnswers: answers.map((answer, index) => index === 1 ? { ...answer, selectedOptions: ["USB", "Battery"] } : answer) }), /Invalid question option/);
  const continuation = new AgentRuntime(design, async options => {
    assert.ok(options.prompt.includes("Store locally"));
    assert.ok(options.prompt.includes("Logging"));
    await call(options, "context_update", params(patch("orchestrator.decisions", { content: "Recorded decisions" })));
    return "Done";
  });
  const resumed = await continuation.start(project.id, { prompt: "Continue", resumedFrom: original.id, userAnswers: answers });
  await continuation.wait(resumed.id);
  const saved = (await design.read(project.id)).runs.find(run => run.id === resumed.id);
  assert.equal(saved.status, "completed", saved.error);
  assert.deepEqual(saved.userAnswers[0].selectedOptions, ["Display", "Logging"]);
});

test("search adapters use provider-specific requests and normalize results offline", async () => {
  const { searchWeb } = await import("../dist/web.js");
  const signal = new AbortController().signal;
  const calls = [];
  const mockFetch = async (...args) => {
    calls.push(args);
    return { text: JSON.stringify({ organic: [
      { title: "Board", link: "https://example.com/board", snippet: "Dimensions" },
      { title: "Duplicate", link: "https://example.com/board" },
      { title: "Invalid", link: "javascript:alert(1)" },
    ] }), contentType: "application/json", url: args[0] };
  };
  const result = await searchWeb("ESP32 dimensions", "serper-test", signal, "serper", mockFetch);
  assert.equal(result.provider, "serper");
  assert.equal(result.results.length, 1);
  assert.deepEqual(result.results[0], { title: "Board", url: "https://example.com/board", description: "Dimensions" });
  assert.equal(calls[0][0], "https://google.serper.dev/search");
  assert.deepEqual(calls[0][2], { "X-API-KEY": "serper-test", "Content-Type": "application/json" });
  assert.deepEqual(JSON.parse(calls[0][4]), { q: "ESP32 dimensions", num: 5 });
  assert.equal(calls[0][1], signal);
  const brave = await searchWeb("board", "brave-test", signal, "brave", async (...args) => {
    assert.equal(new URL(args[0]).hostname, "api.search.brave.com");
    assert.equal(new URL(args[0]).searchParams.get("q"), "board");
    assert.deepEqual(args[2], { "X-Subscription-Token": "brave-test" });
    assert.equal(args[4], undefined);
    return { text: JSON.stringify({ web: { results: [{ title: "Board", url: "https://example.com", description: "Specs" }] } }) };
  });
  assert.equal(brave.provider, "brave");
  assert.equal(brave.results[0].description, "Specs");
  await assert.rejects(searchWeb("query", ""), /Serper API key/);
  await assert.rejects(searchWeb("query", "", undefined, "brave"), /Brave Search API key/);
  await assert.rejects(searchWeb("query", "key", undefined, "unknown"), /Unsupported search provider/);
  await assert.rejects(searchWeb("query", "key", undefined, "serper", async () => ({ text: "not-json" })), /invalid JSON/);
});

test("blocking specialist questions pause orchestration before another specialist is dispatched", async (t) => {
  const { project, design, store } = await fixture(t);
  await configured(store);
  const visited = [];
  const runtime = new AgentRuntime(design, async options => {
    visited.push(options.role);
    if (options.role === "orchestrator") {
      const result = await call(options, "delegate_task", { role: "product", instruction: "Clarify requirements", contextIds: [] });
      assert.equal(result.needsInput, true);
      // Reproduce a model attempting to continue despite a blocking question.
      await call(options, "delegate_task", { role: "hardware", instruction: "Must not execute", contextIds: [] });
      return "Should not reach here";
    }
    const result = await call(options, "ask_user", { title: "Confirm prototype scope", questions: [
      { question: "Connectivity?", options: ["Offline", "Wi-Fi"], inputType: "single" },
      { question: "Functions?", options: ["Display", "Log"], inputType: "multiple" },
    ] });
    assert.equal(result.status, "clarification_required");
    assert.equal(result.questions.length, 2);
    return "Waiting for decisions";
  });
  const run = await runtime.start(project.id, { prompt: "Build a prototype" });
  await runtime.wait(run.id);
  const saved = await design.read(project.id);
  assert.equal(saved.runs[0].status, "awaiting_input", saved.runs[0].error);
  assert.deepEqual(visited, ["orchestrator", "product"]);
  assert.equal(saved.context.entries.filter(entry => entry.data.kind === "question").length, 2);
  assert.equal(saved.runs[0].events.some(event => event.text.includes("delegate_task") && event.type === "error"), false);
});

test("stopped and failed runs retain reusable question cards and accept answers", async (t) => {
  const { pendingQuestionsForRun } = await import("@harness/core");
  const { project, design, store } = await fixture(t);
  await configured(store);
  const runtime = new AgentRuntime(design, async options => {
    await call(options, "ask_user", { questions: [{ question: "Select material", options: ["PLA", "PETG"] }] });
    return "Waiting";
  });
  const run = await runtime.start(project.id, { prompt: "Build enclosure" });
  await runtime.wait(run.id);
  await design.change(project.id, saved => { saved.runs[0].status = "stopped"; });
  const snapshot = await design.read(project.id);
  const questions = pendingQuestionsForRun(snapshot.runs[0], snapshot.context.entries, snapshot.runs);
  assert.equal(questions.length, 1);
  const continuation = new AgentRuntime(design, async options => {
    await call(options, "context_update", params(patch("orchestrator.decisions", { content: "Use PLA" })));
    return "Saved";
  });
  const resumed = await continuation.start(project.id, { prompt: run.prompt, resumedFrom: run.id, userAnswers: questions.map(question => ({ entryId: question.id, revision: question.revision, answer: "PLA" })) });
  await continuation.wait(resumed.id);
  const after = await design.read(project.id);
  assert.equal(after.runs.at(-1).status, "completed", after.runs.at(-1).error);
  assert.equal(pendingQuestionsForRun(after.runs[0], after.context.entries, after.runs).length, 0);
});

test("a plain waiting heading is repaired into a structured question with a bounded fallback", async (t) => {
  const { project, design, store } = await fixture(t);
  await configured(store);
  let calls = 0;
  const runtime = new AgentRuntime(design, async options => {
    calls++;
    if (calls === 1) {
      await call(options, "context_update", params(patch("orchestrator.plan")));
      return "## ⏳ 等待你的确认\n请选择使用 USB 供电还是电池供电。";
    }
    assert.deepEqual(options.tools.map(tool => tool.name).sort(), ["ask_user", "request_input"]);
    return "## ⏳ 等待你的确认\n请选择供电方式。";
  });
  const run = await runtime.start(project.id, { prompt: "Build prototype" });
  await runtime.wait(run.id);
  const saved = await design.read(project.id);
  assert.equal(calls, 2);
  assert.equal(saved.runs[0].status, "awaiting_input", saved.runs[0].error);
  const question = saved.context.entries.find(entry => entry.data.kind === "question");
  assert.equal(question.data.inputType, "text");
  assert.ok(question.content.includes("USB"));
  assert.deepEqual(question.data.options, []);
});

test("real Pi session stops after ask_user instead of requesting another model turn", async (t) => {
  const { project, design, store } = await fixture(t);
  let requests = 0;
  const server = createServer(async (req, res) => {
    for await (const _ of req) { /* Drain the local mock request. */ }
    requests++;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const delta = { role: "assistant", tool_calls: [{ index: 0, id: "ask_1", type: "function", function: { name: "ask_user", arguments: JSON.stringify({ questions: [{ question: "Power source?", options: ["USB", "Battery"], inputType: "single" }] }) } }] };
    res.write(`data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", created: 1, model: "offline-fixture", choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
    res.end(`data: ${JSON.stringify({ id: "mock", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}\n\ndata: [DONE]\n\n`);
  });
  const base = await listen(t, server);
  await configured(store, base + "/v1");
  const runtime = new AgentRuntime(design);
  const run = await runtime.start(project.id, { prompt: "Ask before choosing power" });
  await runtime.wait(run.id);
  const saved = await design.read(project.id);
  assert.equal(saved.runs[0].status, "awaiting_input", saved.runs[0].error);
  assert.equal(requests, 1);
  assert.equal(saved.context.entries.find(e => e.data.kind === "question")?.data.kind, "question");
});

test("long runs continue beyond former tool and delegation limits while retaining saved progress", async (t) => {
  const { project, design, store } = await fixture(t);
  await configured(store);
  let specialists = 0;
  const runtime = new AgentRuntime(design, async options => {
    if (options.role === "orchestrator") {
      for (let index = 0; index < 16; index++) await call(options, "delegate_task", { role: "product", instruction: "Save incremental progress", contextIds: [] });
      return "All steps saved";
    }
    specialists++;
    for (let index = 0; index < 7; index++) await call(options, "context_overview", {});
    await call(options, "context_update", params(patch(`product.step${specialists}`)));
    return "Saved";
  });
  const run = await runtime.start(project.id, { prompt: "Complete a long multi-step task" });
  await runtime.wait(run.id);
  const saved = await design.read(project.id);
  assert.equal(saved.runs[0].status, "completed", saved.runs[0].error);
  assert.equal(specialists, 16);
  assert.equal(saved.context.entries.length, 16);
  assert.ok(saved.runs[0].events.filter(event => event.type === "tool").length > 100);
});

test("real Pi continues length-truncated responses in the same session without replaying tools", async (t) => {
  const { project, design, store } = await fixture(t);
  await configured(store);
  let requests = 0;
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests++;
    if (requests === 2) assert.ok(JSON.stringify(body.messages).includes("hit the output-token limit"));
    const tool = requests === 2 ? { name: "context_update", arguments: JSON.stringify(params(patch("product.recovered"))) } : undefined;
    const delta = tool ? { role: "assistant", tool_calls: [{ index: 0, id: "recovered_1", type: "function", function: tool }] } : { role: "assistant", content: requests === 1 ? "Partial planning" : "Saved product.recovered" };
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", created: 1, model: "offline-fixture", choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
    res.end(`data: ${JSON.stringify({ id: "mock", choices: [{ index: 0, delta: {}, finish_reason: requests === 1 ? "length" : tool ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`);
  });
  const base = await listen(t, server); await configuredAgain();
  async function configuredAgain() { const config = await store.config(); await store.saveConfig({ revision: config.revision, values: { baseUrl: base + "/v1" } }); }
  const runtime = new AgentRuntime(design);
  const run = await runtime.start(project.id, { prompt: "Save requirements", role: "product" });
  await runtime.wait(run.id);
  const saved = await design.read(project.id);
  assert.equal(saved.runs[0].status, "completed", JSON.stringify({error:saved.runs[0].error,requests,events:saved.runs[0].events}));
  assert.equal(requests, 3);
  assert.equal(saved.context.entries[0].revision, 1);
  assert.ok(saved.runs[0].events.some(event => event.text.includes("continuing the same session")));
});

test("failed specialists cannot be concealed by a coordinator plan and contract deliveries are checked", async (t) => {
  const { project, design, store } = await fixture(t); await configured(store);
  const contract = { objective: "Create verified product requirements", editableEntryIds: ["product.required"], expectedEntryIds: ["product.required"], expectedArtifactNames: ["requirements.md"], acceptanceCriteria: ["Both outputs exist"], dependsOnTaskIds: [] };
  const runtime = new AgentRuntime(design, async options => {
    if (options.role === "product") {
      await call(options, "context_update", params(patch("product.required")));
      return "Only entry saved";
    }
    const result = await call(options, "delegate_task", { role: "product", instruction: "Deliver requirements", contextIds: [], contract });
    assert.equal(result.status, "partial");
    assert.ok(result.deliveryIssues.some(issue => issue.includes("requirements.md")));
    await call(options, "context_update", params(patch("orchestrator.plan")));
    return "Plan saved";
  });
  const run = await runtime.start(project.id, { prompt: "Create requirements" }); await runtime.wait(run.id);
  const saved = (await design.read(project.id)).runs[0];
  assert.equal(saved.status, "partial", saved.error);
  assert.equal(saved.tasks[1].status, "partial");
});

test("explicit retry can resolve a failed task and preserve contract scope", async (t) => {
  const { project, design, store } = await fixture(t); await configured(store);
  let tries = 0;
  const contract = { objective: "Create requirement", editableEntryIds: ["product.required"], expectedEntryIds: ["product.required"], expectedArtifactNames: [], acceptanceCriteria: ["Entry ready"], dependsOnTaskIds: [] };
  const runtime = new AgentRuntime(design, async options => {
    if (options.role === "product") {
      if (++tries === 1) throw new Error("Transient specialist failure");
      const forbidden = options.tools.find(tool => tool.name === "context_update");
      const rejected = await forbidden.execute("scope", params(patch("product.outside")), options.signal, () => {});
      assert.equal(rejected.isError, true);
      await call(options, "context_update", params(patch("product.required"))); return "Delivered";
    }
    const tool = options.tools.find(tool => tool.name === "delegate_task");
    await tool.execute("first", { role: "product", instruction: "Deliver", contextIds: [], contract }, options.signal, () => {});
    const current = await design.read(project.id);
    const failed = current.runs[0].tasks.find(task => task.role === "product");
    const result = await call(options, "delegate_task", { role: "product", instruction: "Retry affected scope", contextIds: [], contract, retryOf: failed.id });
    assert.equal(result.status, "completed"); return "Delivered after retry";
  });
  const run = await runtime.start(project.id, { prompt: "Create requirement" }); await runtime.wait(run.id);
  const saved = await design.read(project.id);
  assert.equal(saved.runs[0].status, "completed", saved.runs[0].error);
  assert.equal(saved.context.entries.some(entry => entry.id === "product.outside"), false);
});

test("user decisions survive interruption and multiple continuation links", async (t) => {
  const { project, design, store } = await fixture(t); await configured(store);
  const asker = new AgentRuntime(design, async options => { await call(options, "ask_user", { questions: [{question: "Material?", options: ["PLA", "PETG"]}] }); return "Waiting"; });
  const initial = await asker.start(project.id, {prompt: "Build"}); await asker.wait(initial.id);
  const q = (await design.read(project.id)).context.entries[0];
  const fail = new AgentRuntime(design, async options => { assert.ok(options.prompt.includes("PLA confirmed")); throw new Error("Interrupted before writing decisions"); });
  const answered = await fail.start(project.id, {prompt: "Build", resumedFrom: initial.id, userAnswers: [{entryId:q.id,revision:q.revision,answer:"PLA confirmed"}]}); await fail.wait(answered.id);
  const resume = new AgentRuntime(design, async options => { assert.ok(options.prompt.includes("PLA confirmed")); await call(options,"context_update",params(patch("orchestrator.decisions"))); return "Recovered decision"; });
  const next = await resume.start(project.id,{prompt:"Build",resumedFrom:answered.id}); await resume.wait(next.id);
  const saved = (await design.read(project.id)).runs.at(-1);
  assert.equal(saved.status,"completed",saved.error);
  assert.equal(saved.inheritedAnswers[0].answer,"PLA confirmed");
});

test("pending questions remain available outside the recent run window", async (t) => {
  const { project, design, store } = await fixture(t); await configured(store);
  const asker = new AgentRuntime(design, async options => { await call(options, "ask_user", {questions:[{question:"Printer model?"}]}); return "Waiting"; });
  const first = await asker.start(project.id,{prompt:"Build"}); await asker.wait(first.id);
  await design.change(project.id,saved=>{for(let i=0;i<20;i++)saved.runs.push({id:`history-${i}`,projectId:project.id,role:"orchestrator",prompt:"Later work",status:"completed",createdAt:new Date().toISOString(),tasks:[],events:[]});});
  const base = await listen(t,createApp(store,undefined,{design}));
  const response = await (await fetch(`${base}/api/projects/${project.id}/design`)).json();
  assert.equal(response.runs.length,15);
  assert.equal(response.runs.some(run=>run.id===first.id),false);
  assert.equal(response.pendingInputRuns[0].id,first.id);
});

test("successful tool calls reset repeated-failure protection", async (t) => {
  const { project, design, store } = await fixture(t); await configured(store);
  const runtime = new AgentRuntime(design,async options=>{
    const tool=options.tools.find(item=>item.name==="context_read");
    for(let i=0;i<4;i++){
      const rejected=await tool.execute("bad",{ids:["does.not.exist"]},options.signal,()=>{});
      assert.equal(rejected.isError,true);
      await call(options,"context_overview",{});
    }
    await call(options,"context_update",params(patch("orchestrator.plan")));return "Recovered";
  });
  const run=await runtime.start(project.id,{prompt:"Recover transient errors"});await runtime.wait(run.id);
  const saved=(await design.read(project.id)).runs[0];assert.equal(saved.status,"completed",saved.error);
});
