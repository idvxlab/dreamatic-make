import { useEffect, useRef, useState } from "react";
import { Check, ImagePlus, LoaderCircle, Maximize2, RefreshCw, X } from "lucide-react";
import { APPEARANCE_GATE, approvedAppearance, appearanceOption, type ContextEntry, type AppearanceData } from "@harness/core";
import { api } from "../api";
import type { T } from "../i18n";

function ImageLightbox({projectId, option, previous, onClose, t}: {projectId: string; option: ContextEntry; previous?: ContextEntry; onClose: () => void; t: T}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {dialog.current?.showModal();return () => dialog.current?.close();}, []);
  return <dialog className="concept-lightbox" ref={dialog} onClose={onClose} onCancel={onClose} aria-label={t("设计预览", "Design preview")}>
    <header><strong>{option.title} · v{String(option.data.version)}</strong><button className="icon-button" onClick={onClose} aria-label={t("关闭预览", "Close preview")}><X size={20}/></button></header>
    <div className={previous ? "concept-comparison" : ""}>{[...(previous ? [previous] : []), option].map(e => <figure key={e.id}><img src={api.artifactUrl(projectId, String(e.data.imageId))} alt={`${e.title} v${e.data.version}`} /><figcaption>{e.title} · v{String(e.data.version)}{e.id === option.id ? t(" · 当前", " · Current") : t(" · 上一版", " · Previous")}</figcaption></figure>)}</div>
  </dialog>;
}
export function DesignReviewCard({projectId, entries, runId, visibleRunIds, disabled, t, onChange, onContinue, onExplore}: {
  projectId: string; entries: ContextEntry[]; runId?: string; visibleRunIds: string[]; disabled: boolean; t: T;
  onChange: () => void; onContinue: (runId?: string) => Promise<unknown>; onExplore: (prompt: string) => Promise<unknown>;
}) {
  const all = entries.filter(appearanceOption);
  // Anchor each direction to its original conversation, even when later versions
  // were produced by another run. Render its latest state in that same card.
  const anchors = new Map<string, ContextEntry>();
  for (const entry of all) {
    const id = String(entry.data.directionId), previous = anchors.get(id);
    if (!previous || Number(entry.data.version) < Number(previous.data.version)) anchors.set(id, entry);
  }
  const options = all.filter(e => {
    const origin = anchors.get(String(e.data.directionId))!;
    return runId ? origin.data.runId === runId : !visibleRunIds.includes(String(origin.data.runId));
  });
  const directions = [...new Set(options.map(e => String(e.data.directionId)))];
  const latest = directions.map(id => options.filter(e => e.data.directionId === id).sort((a,b) => Number(b.data.version) - Number(a.data.version))[0]);
  const [selected, setSelected] = useState("");
  const [editing, setEditing] = useState("");
  const [feedback, setFeedback] = useState("");
  const [preserve, setPreserve] = useState("");
  const [references, setReferences] = useState<Array<{artifactId: string; purpose: string}>>([]);
  const [purpose, setPurpose] = useState("form");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState<ContextEntry>();
  const [compare, setCompare] = useState(false);
  const [history, setHistory] = useState("");
  const [exploring, setExploring] = useState(false);
  const [explore, setExplore] = useState("");
  const alive = useRef(true);
  useEffect(() => {alive.current = true;return () => {alive.current = false;};}, []);
  if (!options.length) return null;
  const gate = entries.find(e => e.id === APPEARANCE_GATE);
  const approved = approvedAppearance(entries);
  const selectedOption = latest.find(e => e.id === selected) ?? (approved ? latest.find(e => e.id === approved.id) : undefined);
  const labels: Record<string, string> = {queued: t("排队中", "Queued"), running: t("生成中", "Generating"), succeeded: t("概念预览", "Concept preview"), failed: t("生成失败", "Failed"), cancelled: t("已取消", "Cancelled"), interrupted: t("生成中断", "Interrupted")};
  async function act(operation: () => Promise<unknown>) {
    setBusy(true);setError("");
    try {await operation();if(alive.current) onChange();}
    catch(error) {if(alive.current) setError((error as Error).message);}
    finally {if(alive.current) setBusy(false);}
  }
  const locked = busy || disabled;
  return <section className="design-review" aria-label={t("外观方案评审", "Appearance review")}>
    <div className="design-review-heading"><div><h3>{t("选择产品的外观方向", "Choose a product direction")}</h3><p>{t("点击卡片选中方案，可修改或确认后继续工程设计。", "Click a card to select a direction, refine it, then approve it to continue engineering.")}</p></div>{approved && options.some(e => e.id === approved.id) && <span className="concept-approved"><Check size={14}/>{t("已确认", "Approved")}</span>}</div>
    <div className="concept-grid">{latest.map(option => {
      const data = option.data as unknown as AppearanceData;
      const pending = ["queued", "running"].includes(data.status);
      const isSelected = selectedOption?.id === option.id;
      return <article className={`concept-option ${isSelected ? "selected" : ""}`} key={data.directionId}>
        {data.status === "succeeded" && <button type="button" className="concept-card-select" aria-label={`${t("选择方案", "Select concept")} ${option.title}`} aria-pressed={isSelected} disabled={locked} onClick={() => setSelected(option.id)} />}
        {isSelected && <span className="concept-selected-badge"><Check size={13}/>{t("已选中", "Selected")}</span>}
        <div className="concept-image-wrap">{data.imageId ? <>
          <div className="concept-image"><img loading="lazy" src={api.artifactUrl(projectId, data.thumbnailId || data.imageId)} alt={option.title}/><button type="button" className="concept-enlarge" onClick={() => {setZoom(option);setCompare(false);}} aria-label={`${t("放大查看", "Enlarge")} ${option.title}`}><Maximize2 size={16}/></button></div>
        </> : <div className="concept-placeholder">{pending ? <LoaderCircle className="spin" size={24}/> : <RefreshCw size={23}/>}<span>{labels[data.status]}</span></div>}</div>
        <div className="concept-caption"><div><strong>{option.title}</strong><span>v{data.version}</span></div><p>{option.content}</p>
          {data.feedback && <p className="concept-feedback">{t("本次修改：", "Changes: ")}{data.feedback}</p>}
          {option.status === "needs_review" && <p className="error">{t("设计条件已变化，需要更新预览。", "Design inputs changed. Update this preview.")}</p>}
          {data.error && <p className="error">{data.error}</p>}
          <div className="concept-actions">
            {data.status === "succeeded" && <button type="button" className="secondary concept-refine-button" disabled={locked} onClick={() => {setSelected(option.id);setEditing(option.id);setFeedback("");setPreserve("");setReferences([]);}}>{t("修改此方案", "Refine this concept")}</button>}
            {pending && <button className="text-button" disabled={busy} onClick={() => void act(() => api.appearanceAction(projectId, "cancel", {optionId: option.id}))}>{t("取消生成", "Cancel")}</button>}
            {["failed", "cancelled", "interrupted"].includes(data.status) && <button className="text-button" disabled={busy} onClick={() => void act(() => api.appearanceAction(projectId, "retry", {optionId: option.id, revision: option.revision}))}>{t("重试此方案", "Retry")}</button>}
            {data.parentId && data.imageId && <button className="text-button" onClick={() => {setZoom(option);setCompare(true);}}>{t("比较修改", "Compare")}</button>}
          </div>
          {data.version > 1 && <button className="text-button concept-history-toggle" onClick={() => setHistory(history === data.directionId ? "" : data.directionId)} aria-expanded={history === data.directionId}>{t("历史版本", "Version history")}</button>}
          {history === data.directionId && <div className="concept-history">{all.filter(e => e.data.directionId === data.directionId).map(e => <button key={e.id} disabled={!e.data.imageId} onClick={() => {setZoom(e);setCompare(false);}}>v{String(e.data.version)} · {labels[String(e.data.status)]}</button>)}</div>}
        </div>
      </article>;
    })}</div>
    {editing && <form className="concept-refinement" onSubmit={e => {e.preventDefault();const option = options.find(e => e.id === editing)!;void act(async () => {await api.appearanceAction(projectId, "revise", {optionId: editing, revision: option.revision, feedback, ...(preserve.trim() ? {preserve} : {}), references});if(alive.current){setEditing("");setReferences([]);}});}}>
      <div className="concept-refinement-heading"><strong>{t("修改", "Refine")} · {options.find(e => e.id === editing)?.title}</strong><button className="icon-button" type="button" disabled={busy} onClick={() => setEditing("")} aria-label={t("取消修改", "Cancel refinement")}><X size={16}/></button></div>
      <label><span>{t("希望如何调整？", "What would you like to change?")}</span><textarea value={feedback} required maxLength={4000} onChange={e => setFeedback(e.target.value)} placeholder={t("例如：保留圆角和旋钮，让底座更轻薄，屏幕向上倾斜。", "For example: keep the rounded edges and dial, slim down the base, and tilt the display upward.")}/></label>
      <label><span>{t("需要保留的特征（可选）", "Features to preserve (optional)")}</span><input value={preserve} maxLength={2000} onChange={e => setPreserve(e.target.value)}/></label>
      <div className="concept-attach"><select aria-label={t("参考图用途", "Reference purpose")} value={purpose} onChange={e => setPurpose(e.target.value)}><option value="form">{t("造型参考", "Form reference")}</option><option value="color">{t("配色参考", "Color reference")}</option><option value="detail">{t("细节参考", "Detail reference")}</option></select><label className="reference-upload"><ImagePlus size={15}/>{t("添加参考图", "Add reference")}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={locked || references.length >= 5} onChange={e => {const file = e.target.files?.[0];e.target.value = "";if(file) void act(async () => {const artifact = await api.uploadReference(projectId, file, purpose);if(alive.current)setReferences(refs => [...refs,{artifactId: artifact.id, purpose}]);});}}/></label><small>PNG / JPEG / WebP · ≤ 8 MiB</small></div>
      {!!references.length && <div className="concept-references">{references.map(ref => <figure key={ref.artifactId}><img src={api.artifactUrl(projectId, ref.artifactId)} alt={ref.purpose}/><figcaption><select aria-label={t("参考图用途", "Reference purpose")} value={ref.purpose} onChange={e => setReferences(refs => refs.map(r => r.artifactId === ref.artifactId ? {...r,purpose:e.target.value} : r))}><option value="form">{t("造型", "Form")}</option><option value="color">{t("配色", "Color")}</option><option value="detail">{t("细节", "Detail")}</option></select><button type="button" className="icon-button" onClick={() => setReferences(refs => refs.filter(r => r.artifactId !== ref.artifactId))} aria-label={t("移除参考图", "Remove reference")}><X size={13}/></button></figcaption></figure>)}</div>}
      <button type="submit" className="primary" disabled={locked || !feedback.trim()}>{busy ? t("提交中…", "Submitting…") : t("生成修改版", "Generate revision")}</button>
    </form>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="concept-review-footer">
      <button className="primary" disabled={locked || !selectedOption || selectedOption.status !== "ready" || !gate || approved?.id === selectedOption.id} onClick={() => void act(async () => {await api.appearanceAction(projectId,"confirm",{optionId:selectedOption!.id, revision:selectedOption!.revision,gateRevision:gate!.revision});onChange();await onContinue(selectedOption!.data.runId as string | undefined);})}><Check size={15}/>{t("确认此方案并继续", "Approve and continue")}</button>
      {approved && options.some(e => e.id === approved.id) && <button className="text-button" disabled={locked} onClick={() => void act(() => onContinue(approved.data.runId as string | undefined))}>{t("继续已确认的设计", "Continue approved design")}</button>}
      <button className="text-button" disabled={locked} onClick={() => setExploring(value => !value)}>{t("探索其他方向", "Explore alternatives")}</button>
      <small>{t("概念效果预览，尚未验证尺寸与制造可行性。", "Concept visualization; dimensions and manufacturability remain unverified.")}</small>
    </div>
    {exploring && <form className="concept-explore" onSubmit={e => {e.preventDefault();void act(async () => {await onExplore(`${selectedOption ? `Explore new appearance directions based on concept ${selectedOption.id}; preserve its successful characteristics but do not revise or overwrite it.` : "Explore distinct new appearance directions."} User feedback: ${explore}. Generate images and pause with appearance_review.`);if(alive.current)setExploring(false);});}}><label><span>{t("希望尝试什么方向？", "What direction should we explore?")}</span><textarea required value={explore} maxLength={4000} onChange={e => setExplore(e.target.value)}/></label><button className="secondary" disabled={locked || !explore.trim()}>{t("生成新方向", "Explore new directions")}</button></form>}
    {zoom && <ImageLightbox projectId={projectId} option={zoom} previous={compare ? all.find(e => e.id === zoom.data.parentId) : undefined} onClose={() => setZoom(undefined)} t={t}/>}
  </section>;
}
