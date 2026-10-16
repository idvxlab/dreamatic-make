import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  cp,
  readFile,
  writeFile,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentResources, knowledgeRoot } from "../dist/agents/definitions.js";
import { AgentRuntime } from "../dist/agents/runtime.js";
import { Store } from "../dist/store.js";
import { DesignStore } from "../dist/design-store.js";

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "make-knowledge-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, ".pi");
  await cp(knowledgeRoot, root, { recursive: true });
  return { dir, root, resources: new AgentResources(root) };
}
test("role prompts and Skills are read from Markdown; role catalogs disclose metadata, not unrelated bodies", async (t) => {
  const { root, resources } = await fixture(t),
    snapshot = await resources.load();
  const skillPath = join(root, "skills", "make-parametric-cad", "SKILL.md");
  await writeFile(
    skillPath,
    (await readFile(skillPath, "utf8")) + "\nSKILL-BODY-ONLY-FIXTURE\n",
  );
  const fresh = await resources.load();
  assert.ok(
    fresh
      .list("mechanical")
      .some((skill) => skill.name === "make-parametric-cad"),
  );
  assert.ok(
    !fresh
      .list("firmware")
      .some((skill) => skill.name === "make-parametric-cad"),
  );
  assert.ok(!fresh.prompt("mechanical").includes("SKILL-BODY-ONLY-FIXTURE"));
  assert.ok(
    fresh
      .use("mechanical", "make-parametric-cad", "Build a bracket")
      .body.includes("SKILL-BODY-ONLY-FIXTURE"),
  );
  assert.ok(
    !snapshot
      .use("mechanical", "make-parametric-cad", "Earlier snapshot")
      .body.includes("SKILL-BODY-ONLY-FIXTURE"),
  );
  const agentPath = join(root, "agents", "mechanical.md");
  await writeFile(
    agentPath,
    (await readFile(agentPath, "utf8")) + "\nROLE-UPDATE-FIXTURE\n",
  );
  const updated = await resources.load();
  assert.ok(updated.prompt("mechanical").includes("ROLE-UPDATE-FIXTURE"));
  assert.ok(!fresh.prompt("mechanical").includes("ROLE-UPDATE-FIXTURE"));
  assert.notEqual(
    fresh.agent("mechanical").sha256,
    updated.agent("mechanical").sha256,
  );
  assert.throws(
    () => updated.use("firmware", "make-parametric-cad", "Wrong role"),
    /unavailable/,
  );
});
test("Skill references require loaded knowledge and cannot escape their Skill directory", async (t) => {
  const { root, dir, resources } = await fixture(t),
    snapshot = await resources.load();
  const name = "make-parametric-cad",
    path = "references/csg-recipes.md";
  await assert.rejects(
    snapshot.reference("mechanical", name, path, new Set()),
    /Load this Skill/,
  );
  const loaded = new Set([name]),
    reference = await snapshot.reference("mechanical", name, path, loaded);
  assert.ok(reference.content.includes("subtract"));
  assert.match(reference.sha256, /^[a-f0-9]{64}$/);
  await assert.rejects(
    snapshot.reference(
      "mechanical",
      name,
      "references/../../APPEND_SYSTEM.md",
      loaded,
    ),
    /relative/,
  );
  await assert.rejects(
    snapshot.reference("mechanical", name, "/etc/passwd", loaded),
    /relative/,
  );
  const outside = join(dir, "outside.md");
  await writeFile(outside, "private fixture outside skill");
  await symlink(outside, join(root, "skills", name, "references", "escape.md"));
  await assert.rejects(
    snapshot.reference("mechanical", name, "references/escape.md", loaded),
    /inside/,
  );
});
test("missing or malformed knowledge fails validation rather than silently falling back to embedded prompts", async (t) => {
  const { root, resources } = await fixture(t);
  const path = join(root, "agents", "product.md"),
    original = await readFile(path, "utf8");
  await writeFile(path, original.replace("role: product", "role: unknown"));
  await assert.rejects(resources.load(), /Invalid agent/);
  await writeFile(path, original);
  await rm(path);
  await assert.rejects(resources.load(), /ENOENT/);
});
test("actual runtime tools load Skill bodies and record invocation-local receipts without mutating product Context", async (t) => {
  const { dir, resources } = await fixture(t),
    store = new Store(join(dir, "data"));
  await store.init();
  const project = await store.createProject({ name: "Knowledge runtime" }),
    design = new DesignStore(store);
  await store.saveConfig({
    revision: 0,
    values: { baseUrl: "http://127.0.0.1:1/v1", modelId: "offline-fixture" },
  });
  const driver = async (options) => {
    const tool = async (name, args) => {
      const result = await options.tools
        .find((tool) => tool.name === name)
        .execute("fixture", args, options.signal, () => {}, {});
      assert.ok(!result.isError, JSON.stringify(result));
      return JSON.parse(result.content[0].text);
    };
    const catalog = await tool("list_skills", {});
    assert.ok(catalog.some((skill) => skill.name === "make-parametric-cad"));
    await tool("use_skill", {
      name: "make-parametric-cad",
      rationale:
        "Create a dimensioned bracket using current hardware interfaces",
    });
    const reference = await tool("read_skill_reference", {
      name: "make-parametric-cad",
      path: "references/csg-recipes.md",
    });
    assert.ok(reference.content.includes("cylinder"));
    await tool("context_update", {
      id: "mechanical.fixture",
      baseRevision: 0,
      title: "CAD plan",
      content: "Saved fixture plan",
      dataJson: "{}",
      dependsOn: [],
      artifactIds: [],
      status: "draft",
      reason: "Offline runtime test",
    });
    return "Saved the plan";
  };
  const runtime = new AgentRuntime(design, driver, resources),
    run = await runtime.start(project.id, {
      role: "mechanical",
      prompt: "Plan a bracket",
    });
  await runtime.wait(run.id);
  const snapshot = await design.read(project.id),
    task = snapshot.runs[0].tasks[0];
  assert.equal(snapshot.runs[0].status, "completed", snapshot.runs[0].error);
  assert.equal(task.knowledge.agentPath, ".pi/agents/mechanical.md");
  assert.equal(task.knowledge.skills.length, 1);
  assert.equal(task.knowledge.skills[0].name, "make-parametric-cad");
  assert.equal(task.knowledge.references.length, 1);
  assert.equal(snapshot.context.entries.length, 1);
  assert.ok(
    !snapshot.context.entries.some((entry) => entry.id.includes("skill")),
  );
});
