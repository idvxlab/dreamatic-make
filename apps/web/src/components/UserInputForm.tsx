import { useId, useState } from "react";
import { ArrowRight, Check, MessageSquare } from "lucide-react";
import { clarificationHeading, type ContextEntry, type UserAnswer } from "@harness/core";
import type { T } from "../i18n";

type Draft = { selected: string[]; text: string; custom: boolean };
const empty: Draft = { selected: [], text: "", custom: false };
export function UserInputForm({ questions, busy, disabled, t, onSubmit }: {
  questions: ContextEntry[]; busy: boolean; disabled: boolean; t: T;
  onSubmit: (answers: UserAnswer[]) => Promise<void>;
}) {
  const prefix = useId();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [error, setError] = useState("");
  const update = (id: string, patch: Partial<Draft>) => setDrafts(current => ({ ...current, [id]: { ...(current[id] ?? empty), ...patch } }));
  const answerFor = (question: ContextEntry) => {
    const draft = drafts[question.id] ?? empty;
    return [...draft.selected, draft.text.trim()].filter(Boolean).join("\n");
  };
  const valid = (question: ContextEntry) => {
    const draft = drafts[question.id] ?? empty;
    return Boolean(answerFor(question)) && (!draft.custom || Boolean(draft.text.trim())) && answerFor(question).length <= 4000;
  };
  const answered = questions.filter(valid).length;
  return <form className="user-input-form" onSubmit={async event => {
    event.preventDefault();
    if (answered !== questions.length) return;
    setError("");
    try { await onSubmit(questions.map(question => ({ entryId: question.id, revision: question.revision, answer: answerFor(question), selectedOptions: drafts[question.id]?.selected ?? [] }))); }
    catch (err) { setError((err as Error).message); }
  }}>
    <header className="question-card-heading"><span className="question-card-icon"><MessageSquare size={17} /></span><div><h3>{t("需要你的决定", "A few decisions to move forward")}</h3><p>{t("补充以下信息后，我们将继续处理。", "Share a little more detail, then we’ll continue.")}</p></div><span className="question-progress">{answered}/{questions.length}</span></header>
    {questions.map((question, index) => {
      const options = Array.isArray(question.data.options) ? question.data.options.filter((item): item is string => typeof item === "string") : [];
      const type = question.data.inputType ?? (options.length ? "single" : "text");
      const choice = type !== "text" && options.length > 0;
      const multiple = type === "multiple";
      const draft = drafts[question.id] ?? empty;
      const name = `${prefix}-${question.id}`;
      return <fieldset key={question.id} disabled={busy || disabled} className="question-field">
        <legend><span className="question-number">{String(index + 1).padStart(2, "0")}</span><span>{clarificationHeading(question.content, choice)}</span></legend>
        <span className="question-kind">{choice ? multiple ? t("可选择多项", "Select all that apply") : t("请选择一项", "Choose one option") : t("自由填写", "Write your answer")}</span>
        {choice && <div className="question-options">{options.map((option, optionIndex) => <label key={option} className={`question-option ${draft.selected.includes(option) ? "is-selected" : ""}`}>
          <input type={multiple ? "checkbox" : "radio"} name={name} checked={draft.selected.includes(option)} onChange={() => update(question.id, { selected: multiple ? draft.selected.includes(option) ? draft.selected.filter(item => item !== option) : [...draft.selected, option] : [option], custom: multiple ? draft.custom : false, text: multiple ? draft.text : "" })} />
          <span className="question-option-label">{option}</span><span className="question-option-key" aria-hidden="true">{draft.selected.includes(option) ? <Check size={13} /> : String.fromCharCode(65 + optionIndex)}</span>
        </label>)}
          <label className={`question-option ${draft.custom ? "is-selected" : ""}`}><input type={multiple ? "checkbox" : "radio"} name={name} checked={draft.custom} onChange={() => update(question.id, { custom: !draft.custom, selected: multiple ? draft.selected : [], text: draft.custom ? "" : draft.text })} /><span className="question-option-label">{t("其他，自行填写", "Other, write my own")}</span></label>
        </div>}
        {(!choice || multiple || draft.custom) && <textarea aria-label={t(`问题 ${index + 1} 的回答`, `Answer to question ${index + 1}`)} required={!choice || draft.custom} rows={choice ? 2 : 3} maxLength={4000} value={draft.text} onChange={event => update(question.id, { text: event.target.value })} placeholder={choice && !draft.custom ? t("补充说明（可选）…", "Additional details (optional)…") : t("写下你的答案或具体要求…", "Your answer or specific requirements…")} />}
      </fieldset>;
    })}
    {error && <p role="alert" className="error">{error}</p>}
    <footer className="question-card-footer"><span>{t("答案将保存到项目执行记录", "Answers are saved with your project")}</span><button className="primary" type="submit" disabled={busy || disabled || answered !== questions.length}>{busy ? t("提交中…", "Submitting…") : t("确认并继续", "Confirm & continue")}<ArrowRight size={15} /></button></footer>
  </form>;
}
