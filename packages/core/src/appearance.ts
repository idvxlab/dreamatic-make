import type { ContextEntry } from "./design.js";
export const APPEARANCE_GATE = "appearance.review";
export const appearanceOption = (entry: ContextEntry) => entry.id.startsWith("appearance.option.") && entry.data.kind === "appearance_option";
export type ImageJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "interrupted";
export interface AppearanceData {
  kind: "appearance_option";
  directionId: string;
  version: number;
  attempts?: number;
  parentId?: string;
  title: string;
  description: string;
  prompt: string;
  feedback?: string;
  preserve?: string;
  references: Array<{ artifactId: string; purpose: string }>;
  inputRevisions: Record<string, number>;
  runId?: string;
  status: ImageJobStatus;
  imageId?: string;
  thumbnailId?: string;
  error?: string;
  model: string;
  size: string;
  quality: string;
  outputFormat?: string;
  configRevision: number;
}
export function approvedAppearance(entries: ContextEntry[]): ContextEntry | undefined {
  const gate = entries.find(e => e.id === APPEARANCE_GATE && e.status === "ready" && e.data.state === "approved");
  if (!gate) return;
  const option = entries.find(e => e.id === gate.data.optionId);
  if (!option || option.revision !== gate.data.optionRevision || option.status !== "ready" || option.data.status !== "succeeded") return;
  const inputs = option.data.inputRevisions as Record<string, number> | undefined;
  if (Object.entries(inputs ?? {}).some(([id, rev]) => entries.find(e => e.id === id)?.revision !== rev)) return;
  return option;
}
