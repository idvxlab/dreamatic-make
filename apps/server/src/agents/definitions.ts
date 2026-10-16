import { readFile, realpath, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import {
  loadSkillsFromDir,
  parseFrontmatter,
} from "@earendil-works/pi-coding-agent";
import {
  InputError,
  ROLES,
  roleIds,
  type RoleId,
  type SkillReceipt,
} from "@harness/core";

/** Explicit project knowledge only; never scan cwd, ~/.pi or reference projects. */
export const knowledgeRoot = fileURLToPath(
  new URL("../../../../.pi/", import.meta.url),
);
export const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");
interface AgentDefinition {
  role: RoleId;
  name: string;
  description: string;
  path: string;
  body: string;
  sha256: string;
}
interface SkillDefinition {
  name: string;
  description: string;
  path: string;
  absolutePath: string;
  baseDir: string;
  roles: RoleId[];
  body: string;
  sha256: string;
}
export interface SkillSummary {
  name: string;
  description: string;
  path: string;
  sha256: string;
}
function contained(root: string, path: string) {
  return path === root || path.startsWith(root + sep);
}
async function inside(root: string, path: string) {
  const file = await realpath(path);
  if (!contained(root, file))
    throw new InputError(
      "Knowledge path must remain inside its project resource directory",
    );
  return file;
}
async function markdown(path: string, max = 32000) {
  if ((await stat(path)).size > max * 4)
    throw new InputError(`Knowledge file too large: ${path}`);
  const raw = await readFile(path, "utf8");
  if (raw.length > max || !raw.trim())
    throw new InputError(`Knowledge file is empty or too large: ${path}`);
  return raw;
}
export class AgentResources {
  constructor(readonly root = knowledgeRoot) {}
  /** A fresh immutable body snapshot per run; edits apply to the next run without a build. */
  async load(): Promise<KnowledgeSnapshot> {
    const root = await realpath(this.root),
      agentsRoot = await realpath(join(root, "agents")),
      skillsRoot = await realpath(join(root, "skills"));
    if (!contained(root, agentsRoot) || !contained(root, skillsRoot))
      throw new InputError("Knowledge directories must remain inside .pi");
    const sharedPath = await inside(root, join(root, "APPEND_SYSTEM.md"));
    const shared = await markdown(sharedPath);
    const agents = await Promise.all(
      roleIds.map(async (role) => {
        const path = await inside(agentsRoot, join(agentsRoot, `${role}.md`));
        const raw = await markdown(path),
          { frontmatter, body } =
            parseFrontmatter<Record<string, unknown>>(raw);
        if (
          frontmatter.role !== role ||
          typeof frontmatter.name !== "string" ||
          typeof frontmatter.description !== "string" ||
          !body.trim()
        )
          throw new InputError(`Invalid agent Markdown: ${role}.md`);
        return {
          role,
          name: frontmatter.name,
          description: frontmatter.description,
          path: `.pi/agents/${role}.md`,
          body,
          sha256: sha256(raw),
        };
      }),
    );
    const catalog = loadSkillsFromDir({ dir: skillsRoot, source: "project" });
    if (catalog.diagnostics.length)
      throw new InputError(
        `Invalid project Skills: ${catalog.diagnostics.map((item) => item.message).join("; ")}`,
      );
    const skills = await Promise.all(
      catalog.skills.map(async (skill) => {
        const absolutePath = await inside(skillsRoot, skill.filePath),
          raw = await markdown(absolutePath);
        const { frontmatter, body } = parseFrontmatter<{
          metadata?: { roles?: unknown };
        }>(raw);
        const configured = frontmatter.metadata?.roles;
        const roles =
          configured === undefined
            ? [...roleIds]
            : typeof configured === "string"
              ? configured.split(",").map((value) => value.trim())
              : configured;
        if (
          !Array.isArray(roles) ||
          !roles.length ||
          roles.some((role) => !roleIds.includes(role as RoleId)) ||
          new Set(roles).size !== roles.length ||
          !body.trim() ||
          skill.disableModelInvocation
        )
          throw new InputError(`Invalid Skill roles/body: ${skill.name}`);
        return {
          name: skill.name,
          description: skill.description,
          path: `.pi/skills/${relative(skillsRoot, absolutePath).split(sep).join("/")}`,
          absolutePath,
          baseDir: await realpath(skill.baseDir),
          roles: roles as RoleId[],
          body,
          sha256: sha256(raw),
        };
      }),
    );
    return new KnowledgeSnapshot(root, shared, agents, skills);
  }
}
export class KnowledgeSnapshot {
  constructor(
    private root: string,
    private shared: string,
    private agents: AgentDefinition[],
    private skills: SkillDefinition[],
  ) {}
  list(role: RoleId, query = ""): SkillSummary[] {
    const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return this.skills
      .filter(
        (skill) =>
          skill.roles.includes(role) &&
          words.every((word) =>
            `${skill.name} ${skill.description}`.toLowerCase().includes(word),
          ),
      )
      .map(({ name, description, path, sha256 }) => ({
        name,
        description,
        path,
        sha256,
      }));
  }
  agent(role: RoleId) {
    return this.agents.find((agent) => agent.role === role)!;
  }
  prompt(role: RoleId) {
    const agent = this.agent(role);
    return `You are ${agent.name} in dreamatic-make. Reply in the user's language.\n\n${agent.body}\n\n${this.shared}\n\nAvailable team: ${ROLES.map((item) => `${item.id}: ${item.name[1]}`).join("; ")}.\n\nAvailable project Skills (metadata only; use use_skill for instructions):\n${JSON.stringify(this.list(role))}`;
  }
  use(role: RoleId, name: string, rationale: string) {
    const skill = this.skills.find(
      (skill) => skill.name === name && skill.roles.includes(role),
    );
    if (!skill)
      throw new InputError(
        "Unknown or unavailable Skill for this role. Use list_skills.",
      );
    const receipt: SkillReceipt = {
      name: skill.name,
      path: skill.path,
      sha256: skill.sha256,
      rationale,
      loadedAt: new Date().toISOString(),
    };
    return { receipt, body: skill.body };
  }
  async reference(
    role: RoleId,
    name: string,
    path: string,
    loaded: ReadonlySet<string>,
  ) {
    const skill = this.skills.find(
      (skill) => skill.name === name && skill.roles.includes(role),
    );
    if (!skill || !loaded.has(name))
      throw new InputError(
        "Load this Skill using use_skill before reading supporting references",
      );
    if (
      !path.startsWith("references/") ||
      path.includes("\\") ||
      path.split("/").some((part) => part === ".." || part === "." || !part) ||
      !path.endsWith(".md")
    )
      throw new InputError(
        "Use a relative references/*.md path inside the loaded Skill",
      );
    const absolute = await inside(skill.baseDir, resolve(skill.baseDir, path));
    const content = await markdown(absolute, 24000);
    return {
      name,
      path: `${skill.path.slice(0, -"SKILL.md".length)}${path}`,
      sha256: sha256(content),
      content,
    };
  }
}
