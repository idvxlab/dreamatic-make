import { pendingQuestionsForRun, type AgentRun, type ContextEntry, type UserAnswer } from "@harness/core";
import type { T } from "../i18n";
import { UserInputForm } from "./UserInputForm";

/** One rendering path for live, completed, interrupted and recovered questions. */
export function ClarificationCard({ run, runs, entries, busy, disabled, t, onSubmit }: {
  run: AgentRun; runs: AgentRun[]; entries: ContextEntry[];
  busy: boolean; disabled: boolean; t: T;
  onSubmit: (answers: UserAnswer[]) => Promise<void>;
}) {
  const questions = pendingQuestionsForRun(run, entries, runs);
  if (!questions.length) return null;
  return <UserInputForm key={questions.map(item => `${item.id}:${item.revision}`).join("|")} questions={questions} busy={busy} disabled={disabled} t={t} onSubmit={onSubmit} />;
}
