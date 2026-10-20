import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Box, CircuitBoard, Droplets, LoaderCircle, Pause, Play, Upload } from "lucide-react";
import { approvedAppearance, PRODUCT_MODEL_ENTRY, type ContextEntry, type ProductModelResponse, type ModelSample } from "@harness/core";
import { api } from "../api";
import type { T } from "../i18n";
const Scene = lazy(() => import("./EngineSceneViewer"));
type View = "motion" | "collision" | "circuit" | "flow";
const sample = (value?: ModelSample | null) => value ? `${value.value ?? "?"} · ${value.quality} · ${value.origin}` : "—";

function Topology({ nodes, edges, selected, onSelect }: { nodes: string[]; edges: [string, string][]; selected: string; onSelect: (id: string) => void }) {
  const visible = [...new Set(nodes)].slice(0, 120);
  const positions = new Map(visible.map((id, index) => [id, { x: (index % 2) * 340 + 15, y: Math.floor(index / 2) * 74 + 15 }]));
  return <div className="engine-graph"><svg role="img" aria-label="Model topology" viewBox={`0 0 680 ${Math.max(140, Math.ceil(visible.length / 2) * 74 + 20)}`}>
    {edges.map(([a, b], i) => {
      const from = positions.get(a), to = positions.get(b);
      if (!from || !to) return null;
      return <path key={i} d={`M ${from.x + 150} ${from.y + 24} L ${to.x + 150} ${to.y + 24}`} stroke="#91a576" strokeWidth="2" fill="none" />;
    })}
    {visible.map(id => {
      const p = positions.get(id)!;
      return <g key={id} role="button" tabIndex={0} aria-label={id} onClick={() => onSelect(id)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(id); } }}>
        <title>{id}</title><rect x={p.x} y={p.y} width="300" height="48" rx="8" fill={selected === id ? "#dce9c3" : "#fafbf6"} stroke="#a8b594" />
        <text x={p.x + 12} y={p.y + 20} fontSize="12" fill="#37422b">{id.length > 40 ? `…${id.slice(-39)}` : id}</text>
        <text x={p.x + 12} y={p.y + 37} fontSize="10" fill="#6d795f">{id.split("/").slice(-2, -1)[0] ?? "node"}</text>
      </g>;
    })}
  </svg>{nodes.length > 120 && <p>Showing the first 120 nodes. Full topology is available in the result artifact.</p>}</div>;
}

export default function ProductModelWorkspace({ projectId, entries, onChanged, t }: {
  projectId: string; entries: ContextEntry[]; onChanged: () => void; t: T;
}) {
  const source = entries.find(e => e.id === PRODUCT_MODEL_ENTRY), resultEntry = entries.find(e => e.id === "validation.product_model");
  const [response, setResponse] = useState<ProductModelResponse>(), [view, setView] = useState<View>("motion");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [selected, setSelected] = useState("");
  const [frameIndex, setFrameIndex] = useState(0), [playing, setPlaying] = useState(false);
  const [bundle, setBundle] = useState<File>(), [scenario, setScenario] = useState<File>();
  const controller = useRef<AbortController | null>(null), generation = useRef(0);
  const adopt = (value: ProductModelResponse) => { setResponse(value); setFrameIndex(0); setPlaying(false); setSelected(""); };
  async function execute(work: (signal: AbortSignal) => Promise<ProductModelResponse>, changed = false) {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    const ticket = ++generation.current;
    setBusy(true); setError(""); setPlaying(false);
    try { const value = await work(abort.signal); if (ticket === generation.current && !abort.signal.aborted) { adopt(value); if (changed) onChanged(); } }
    catch (e) { if (ticket === generation.current && !abort.signal.aborted) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (ticket === generation.current) setBusy(false); }
  }
  useEffect(() => {
    if (source) { setResponse(undefined); void execute(signal => api.productModel(projectId, signal)); }
    return () => { generation.current++; controller.current?.abort(); };
    // Reload when persisted source/result revisions change, not on every project event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, source?.revision, resultEntry?.revision]);
  const workspace = response?.workspace, frames = workspace?.result?.frames ?? [], frame = frames[frameIndex];
  useEffect(() => {
    if (!playing || !frames.length) return;
    if (frameIndex >= frames.length - 1) { setPlaying(false); return; }
    const timer = setTimeout(() => setFrameIndex(i => i + 1), Math.max(16, (frames[frameIndex + 1].time_s - frames[frameIndex].time_s) * 1000));
    return () => clearTimeout(timer);
  }, [playing, frameIndex, frames]);
  async function importModel(signal: AbortSignal) {
    if (!bundle || !scenario) throw new Error(t("请选择模型和场景两个 JSON 文件。", "Select both bundle and scenario JSON files."));
    if (bundle.size + scenario.size > 1000000) throw new Error(t("两个文件合计不得超过 1 MB。", "The two files must total less than 1 MB."));
    const values = await Promise.all([bundle.text(), scenario.text()]);
    return api.modelAction(projectId, "import", { bundle: JSON.parse(values[0]), scenario: JSON.parse(values[1]), baseRevision: source?.revision ?? 0 }, signal);
  }
  const outdated = !response?.demo && !!response && (response.sourceRevision !== source?.revision || source?.status === "needs_review" || response.stale);
  const canRun = !!source && !outdated && !!approvedAppearance(entries) && !response?.demo;
  const nets = workspace?.circuit.nets ?? [], behaviors = workspace?.circuit.behaviors ?? [];
  const circuitEdges: [string, string][] = [
    ...nets.flatMap(net => net.members.map(member => [net.entity_ref, member] as [string, string])),
    ...behaviors.flatMap(behavior => Object.entries(behavior.inputs).map(([name, input]) => [input.source_entity_ref ?? `${behavior.entity_ref}/inputs/${name}${input.channel ? ` (${input.channel})` : ""}`, behavior.entity_ref] as [string, string])),
  ];
  const circuitNodes = [...(workspace?.circuit.terminals.map(n => n.entity_ref) ?? []), ...nets.map(n => n.entity_ref), ...behaviors.map(b => b.entity_ref), ...circuitEdges.flat()];
  const flowEdges: [string, string][] = [...(workspace?.flow.paths.map(p => [p.inlet_ref, p.outlet_ref] as [string, string]) ?? []), ...(workspace?.flow.connections.map(c => [c.a, c.b] as [string, string]) ?? [])];
  const entities = workspace ? [...workspace.scene.bodies, ...workspace.scene.envelopes, ...workspace.scene.joints, ...workspace.circuit.terminals, ...nets, ...behaviors, ...workspace.flow.ports] : [];
  const entity = entities.find(n => n.entity_ref === selected);
  const selectedSample = frame?.network_samples[selected] ?? frame?.behavior_outputs[selected] ?? frame?.sensor_samples[selected] ?? frame?.effects[selected];
  const inspected = entity && { ...entity,
    ...(frame?.body_poses[selected] ? { world_pose: frame.body_poses[selected] } : {}),
    ...(frame && selected in frame.joint_positions ? { position_si: frame.joint_positions[selected] } : {}),
    ...(selectedSample ? { sample: selectedSample } : {}) };
  const collisions = frame?.collisions ?? workspace?.scene.collisions ?? [];
  return <section className="engine-workspace">
    <header className="engine-header"><div><span className="engine-eyebrow">PRODUCT MODEL ENGINE</span><h2>{t("设计与仿真", "Design & simulation")}</h2>
      <p>{t("同一模型，多种视图。检查包络、运动与信号如何协同工作。", "One model, multiple views. Inspect envelopes, motion and signals together.")}</p></div>
      <button className="primary" disabled={busy || !canRun} onClick={() => void execute(signal => api.modelAction(projectId, "simulate", { baseRevision: source!.revision }, signal), true)}><Play size={15} />{t("运行项目仿真", "Run simulation")}</button>
    </header>
    <div className="engine-source-bar"><strong>{t("项目模型", "Project model")}</strong>
      <label>{t("模型 JSON", "Bundle JSON")}<input type="file" accept=".json,application/json" disabled={busy} onChange={e => setBundle(e.target.files?.[0])} /></label>
      <label>{t("场景 JSON", "Scenario JSON")}<input type="file" accept=".json,application/json" disabled={busy} onChange={e => setScenario(e.target.files?.[0])} /></label>
      <button className="secondary" disabled={busy || !bundle || !scenario} onClick={() => void execute(importModel, true)}><Upload size={14} />{t("导入并校验", "Import & validate")}</button>
      {source && <button className="secondary" disabled={busy} onClick={() => void execute(signal => api.productModel(projectId, signal))}>{t("加载项目模型", "Load project model")} · r{source.revision}</button>}
    </div>
    <div className="engine-examples"><span>{t("体验示例（不保存到项目）", "Try an example (not saved)")}</span>
      {([["actuator", t("机械臂", "Actuator")], ["fan", t("风扇", "Fan")], ["lamp", t("台灯", "Lamp")]] as const).map(([name, label]) => <button className="secondary" key={name} disabled={busy} onClick={() => void execute(signal => api.modelAction(projectId, "demo", { name }, signal))}>{label}</button>)}
      {busy && <><LoaderCircle size={15} className="spin" /><button className="secondary" onClick={() => { controller.current?.abort(); generation.current++; setBusy(false); }}>{t("取消", "Cancel")}</button></>}
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    {outdated && <p className="provider-notice">{t("模型输入已经变化。请复核、更新快照并重新导入；当前结果仅供追溯。", "Model inputs changed. Review, update and reimport the snapshot. Current results are historical.")}</p>}
    {!approvedAppearance(entries) && <p className="engine-note">{t("项目仿真需要先在设计评审中确认外观方案。现在可以导入预览，或体验示例。", "Project simulation requires appearance approval in Design Review. Imports, previews and examples are available now.")}</p>}
    {!workspace ? <div className="engine-empty"><Box size={42} /><h3>{t("让设计从静态模型变为可检查的系统", "Explore your design as a working system")}</h3>
      <p>{t("导入引擎的 bundle 与 scenario，或点击上方示例开始。原有 STL 文件仍可在下方查看。", "Import an engine bundle and scenario, or start with an example above. Existing STL files remain available below.")}</p></div> : <>
      <div className="engine-status"><span className="engine-badge">{response.demo ? t("合成示例", "Synthetic example") : `r${response.sourceRevision}`}</span>
        <code title={workspace.snapshot_id}>{workspace.snapshot_id.slice(0, 18)}…</code>
        <span>{workspace.result?.status ?? t("初始姿态预览", "Initial pose preview")}</span>
        <span>{workspace.scene.bodies.length} {t("刚体", "bodies")} · {workspace.scene.joints.length} {t("关节", "joints")} · {nets.length} {t("电气网络", "nets")}</span>
        {response.resultArtifactId && <a href={api.artifactUrl(projectId, response.resultArtifactId)}>{t("下载结果", "Download result")}</a>}
      </div>
      <div className="engine-tabs" role="tablist" aria-label={t("引擎视图", "Engine views")}>
        {([{ id: "motion", label: t("运动", "Motion"), icon: Box }, { id: "collision", label: t("碰撞", "Collision"), icon: Box }, { id: "circuit", label: t("电路逻辑", "Circuit & logic"), icon: CircuitBoard }, { id: "flow", label: t("物料流", "Material flow"), icon: Droplets }] as const).map(item => <button role="tab" aria-selected={view === item.id} className={view === item.id ? "selected" : ""} key={item.id} onClick={() => setView(item.id)}><item.icon size={16} />{item.label}</button>)}
      </div>
      <div className="engine-main"><div className="engine-viewport" role="tabpanel">
        {(view === "motion" || view === "collision") && <Suspense fallback={<p>{t("加载 3D 视图…", "Loading 3D view…")}</p>}><Scene workspace={workspace} frame={frame} collision={view === "collision"} selected={selected} onSelect={setSelected} t={t} /></Suspense>}
        {view === "circuit" && <><Topology nodes={circuitNodes} edges={circuitEdges} selected={selected} onSelect={setSelected} /><div className="engine-readings">{[...nets.map(n => [n.entity_ref, frame?.network_samples[n.entity_ref] ?? n.sample] as const), ...behaviors.map(n => [n.entity_ref, frame?.behavior_outputs[n.entity_ref] ?? n.sample] as const), ...Object.entries(frame?.sensor_samples ?? {}), ...Object.entries(frame?.effects ?? {})].map(([key, value]) => <div key={key}><code>{key}</code><span>{sample(value)}</span></div>)}</div></>}
        {view === "flow" && <><p className="engine-note">{t("仅显示端口和通路拓扑；没有计算流量、压力或颗粒动力学。", "Port and path topology only. Flow rate, pressure and particle dynamics are not computed.")}</p><Topology nodes={workspace.flow.ports.map(p => p.entity_ref)} edges={flowEdges} selected={selected} onSelect={setSelected} /></>}
      </div><aside className="engine-inspector"><h3>{t("元件检查", "Inspect element")}</h3>
        <label>{t("选择实体", "Select entity")}<select value={selected} onChange={e => setSelected(e.target.value)}><option value="">{t("点击模型或选择…", "Click model or select…")}</option>{[...new Set(entities.map(o => o.entity_ref))].map(id => <option key={id} value={id}>{id}</option>)}</select></label>
        {inspected && <pre>{JSON.stringify(inspected, null, 2)}</pre>}
        {view === "motion" && Object.entries(frame?.joint_positions ?? {}).map(([id, value]) => <p key={id}><code>{id}</code><br />{value.toFixed(4)} SI</p>)}
        {view === "collision" && <><h4>{t("本帧碰撞对", "Colliding pairs in frame")} · {collisions.length}</h4>{collisions.map(([a, b]) => <p key={`${a}:${b}`}><button onClick={() => setSelected(a)}>{a}</button> ↔ <button onClick={() => setSelected(b)}>{b}</button></p>)}<p>{t("红色表示已报告重叠。零碰撞不代表实物安全；请查看几何覆盖范围和诊断。", "Red indicates reported overlap. Zero pairs do not establish physical safety; review geometry coverage and diagnostics.")}</p></>}
        <p className="engine-note">{t("Envelope 简化模型 · 软件仿真结果，不等于物理验证。", "Simplified envelopes · Software simulation, not physical validation.")}</p>
      </aside></div>
      <div className="engine-timeline"><button className="secondary" disabled={frames.length < 2} aria-label={playing ? t("暂停", "Pause") : t("播放", "Play")} onClick={() => { if (frameIndex === frames.length - 1) setFrameIndex(0); setPlaying(!playing); }}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
        <input type="range" aria-label={t("仿真时间", "Simulation time")} min={0} max={Math.max(0, frames.length - 1)} value={frameIndex} disabled={!frames.length} onChange={e => { setPlaying(false); setFrameIndex(Number(e.target.value)); }} />
        <code>{(frame?.time_s ?? 0).toFixed(3)} / {(workspace.result?.actual_end_s ?? 0).toFixed(3)} s</code>
      </div>
      <details className="engine-diagnostics" open><summary>{t("诊断与覆盖范围", "Diagnostics & coverage")} · {workspace.diagnostics.length}</summary>
        <p>{workspace.result?.coverage.join(" · ") || t("尚未运行完整场景。", "Full scenario has not been run.")}</p>
        {workspace.diagnostics.map((diagnostic, i) => <div key={i} className={`engine-diagnostic ${diagnostic.severity}`}><strong>{diagnostic.code} · {diagnostic.outcome}</strong><span>{diagnostic.message}</span>{diagnostic.object_refs?.map(id => <button key={id} onClick={() => setSelected(id)}>{id}</button>)}</div>)}
      </details>
    </>}
  </section>;
}
