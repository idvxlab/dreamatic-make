import type { AgentRun, AgentTask, ContextEntry, UserAnswer } from "./design.js";

export interface TaskContract {
  objective: string;
  editableEntryIds: string[];
  expectedEntryIds: string[];
  expectedArtifactNames: string[];
  acceptanceCriteria: string[];
  dependsOnTaskIds: string[];
}
export function inheritedAnswers(run: AgentRun, runs: AgentRun[]): UserAnswer[] {
  const chain: AgentRun[] = []; const seen = new Set<string>();
  let current: AgentRun | undefined = run;
  while (current && !seen.has(current.id)) {
    seen.add(current.id); chain.unshift(current);
    current = runs.find(item => item.id === current!.resumedFrom);
  }
  const answers = new Map<string, UserAnswer>();
  for (const item of chain) for (const answer of [...(item.inheritedAnswers ?? []), ...(item.userAnswers ?? [])]) answers.set(answer.entryId, answer);
  return [...answers.values()];
}
export function unresolvedTaskFailures(tasks: AgentTask[]): boolean {
  return tasks.some((task, index) => task.role !== "orchestrator" && ["failed", "blocked", "partial"].includes(task.status) &&
    !tasks.slice(index + 1).some(retry => retry.status === "completed" && retry.retryOf === task.id));
}
export function validateTaskDelivery(task: AgentTask, entries: ContextEntry[], artifacts: Array<{id: string; name: string}>): string[] {
  const contract = task.contract;
  if (!contract) return [];
  const missing: string[] = [];
  for (const id of contract.expectedEntryIds) {
    const entry = entries.find(item => item.id === id);
    if (!entry || !task.outputIds.includes(id) || entry.status !== "ready") missing.push(`Entry not delivered ready: ${id}`);
  }
  for (const name of contract.expectedArtifactNames) {
    if (!artifacts.some(item => item.name === name && task.outputIds.includes(item.id))) missing.push(`Artifact not delivered: ${name}`);
  }
  if (task.needsReview) missing.push("Task inputs changed; review required");
  return missing;
}
