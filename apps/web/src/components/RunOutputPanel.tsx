import { useEffect, useId, useRef, useState } from "react";
import { Activity, Check, LoaderCircle } from "lucide-react";
import { roleName, type AgentRun } from "@harness/core";
import type { T } from "../i18n";
import { primaryRunOutput, outputPreview } from "../run-presentation";

function RunActivity({ run, t, statusLabel, id }: {
  run: AgentRun; t: T; statusLabel: (status: string) => string; id: string;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    const area = scroll.current;
    if (area && follow.current) area.scrollTop = area.scrollHeight;
  }, [run.events, run.tasks]);
  return <div id={id} className="inline-run-activity" ref={scroll} role="region" aria-label={t("运行过程", "Execution activity")} tabIndex={0}
    onScroll={() => { const area = scroll.current; if (area) follow.current = area.scrollHeight - area.scrollTop - area.clientHeight < 40; }}>
    <div className="inline-task-status">{run.tasks.map(task => <span key={task.id}>{roleName(task.role, t("zh", "en"))} · {statusLabel(task.status)}</span>)}</div>
    {run.events.length ? run.events.map(event => <div className={`inline-activity-event ${event.type}`} key={event.id}>
      <time>{new Date(event.at).toLocaleTimeString()}</time><div><span>{roleName(event.role, t("zh", "en"))}</span><pre>{event.text}</pre></div>
    </div>) : <p>{t("等待运行记录…", "Waiting for activity…")}</p>}
  </div>;
}

export function RunOutputPanel({ run, t, statusLabel, children }: {
  run: AgentRun; t: T; statusLabel: (status: string) => string; children: React.ReactNode;
}) {
  const [inspect, setInspect] = useState(false);
  const activityId = useId();
  const working = ["queued", "running"].includes(run.status);
  const result = outputPreview(primaryRunOutput(run));
  return <section className="run-output-panel minimal-output">
    {run.error && <p className="output-error" role="alert">{run.error}</p>}
    {!working && result && <div className="message-result">{result}</div>}
    {working && <div className="quiet-working" role="status"><LoaderCircle size={13} className="spin" />{t("正在处理…", "Working…")}</div>}
    {children}
    <button type="button" className="run-inspect-trigger" onClick={() => setInspect(value => !value)} aria-expanded={inspect} aria-controls={activityId}>
      {working ? <Activity size={12} /> : run.status === "completed" ? <Check size={12} /> : <Activity size={12} />}
      <span>{statusLabel(run.status)}</span><span className="inspect-separator">·</span><span>{inspect ? t("隐藏过程", "Hide activity") : t("查看过程", "View activity")}</span>
    </button>
    {inspect && <RunActivity id={activityId} run={run} t={t} statusLabel={statusLabel} />}
  </section>;
}
