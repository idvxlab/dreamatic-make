import { AgentResources } from "../apps/server/dist/agents/definitions.js";
import { ROLES } from "@harness/core";
const knowledge = await new AgentResources().load();
const skills = new Set();
for (const role of ROLES) {
  const agent = knowledge.agent(role.id);
  const catalog = knowledge.list(role.id);
  if (!catalog.length) throw new Error(`No Skills available for ${role.id}`);
  for (const skill of catalog) skills.add(skill.name);
  console.log(`${agent.path}: ${catalog.length} applicable Skills`);
}
console.log(
  `Validated ${ROLES.length} Agent Markdown files, shared rules and ${skills.size} project Skills.`,
);
