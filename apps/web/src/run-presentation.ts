import type { AgentRun } from "@harness/core";

/** Prefer the coordinator's final result over specialist chatter or tool logs. */
export function primaryRunOutput(run: AgentRun): string {
  const coordinator = [...run.tasks].reverse().find(task => task.role === "orchestrator" && task.summary.trim());
  if (coordinator && coordinator.status !== "running" && coordinator.status !== "queued") return coordinator.summary;
  if (run.status === "running" || run.status === "queued") return "";
  return [...run.events].reverse().find(event => event.type === "text" && event.role === "orchestrator")?.text
    ?? [...run.tasks].reverse().find(task => task.summary.trim())?.summary ?? "";
}
export function outputPreview(text: string): string {
  return text.replace(/^\s*#{1,6}\s*/gm, "").replace(/\*\*|__|`/g, "").replace(/\n{3,}/g, "\n\n").trim();
}
