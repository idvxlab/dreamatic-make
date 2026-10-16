import type { AgentRun, ContextEntry, QuestionInputType } from "./design.js";

export interface ClarificationQuestion {
  question: string;
  options?: string[];
  inputType?: QuestionInputType;
}

/** Questions remain pending even when their parent run was stopped or failed. */
export function pendingQuestionsForRun(run: AgentRun, entries: ContextEntry[], runs: AgentRun[]): ContextEntry[] {
  const tasks = new Set(run.tasks.map(task => task.id));
  const answered = new Set(runs.flatMap(item => item.userAnswers ?? []).map(answer => answer.entryId));
  return entries.filter(entry => entry.data.kind === "question" &&
    (entry.data.runId === run.id || tasks.has(String(entry.data.taskId))) && !answered.has(entry.id));
}

/** A narrow recovery signal, never a parser for choices or user authorization. */
export function hasUnstructuredQuestion(summary: string): boolean {
  return /(?:^|\n)\s*#{1,6}\s*[^\n]*(?:等待.{0,8}(?:确认|回答|选择|输入)|awaiting (?:your |user )?(?:confirmation|input)|waiting for (?:your |user )?(?:confirmation|input))/imu.test(summary);
}

/** Choice details belong in option rows, not repeated in the question heading.
 * Stored content remains unchanged for provenance and agent continuation.
 */
export function clarificationHeading(content: string, hasOptions: boolean): string {
  if (!hasOptions) return content;
  const plain = content.replace(/\\([*_`#])/gu, "$1")
    .replace(/^\s*#{1,6}\s+/gmu, "")
    .replace(/\*\*|__|`/gu, "")
    .trim();
  const questionEnd = plain.search(/[？?]/u);
  if (questionEnd >= 0) return plain.slice(0, questionEnd + 1).trim();
  return plain.split(/\n\s*\n|\n/gu)[0]!.replace(/^\*|\*$/gu, "").trim();
}
