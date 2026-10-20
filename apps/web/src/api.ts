import type {
  ConfigSnapshot,
  Field,
  Project,
  WorkspaceView,
  ContextPatch,
  RoleId,
  AgentRun,
  UserAnswer,
} from "@harness/core";
export type Config = ConfigSnapshot & { fields: Field[] };
export interface Diagnostic {
  ok: boolean;
  piVersion: string;
  modelId: string;
  activeTools: string[];
  message: string;
}
export async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    signal,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await res.json();
  if (!res.ok) throw new Error(value.error || `HTTP ${res.status}`);
  return value as T;
}
export const api = {
  productModel: (id: string, signal?: AbortSignal) => request<import("@harness/core").ProductModelResponse>(`/projects/${id}/model`, "GET", undefined, signal),
  modelAction: (id: string, action: "import" | "simulate" | "demo", body: unknown, signal?: AbortSignal) =>
    request<import("@harness/core").ProductModelResponse>(`/projects/${id}/model/${action}`, "POST", body, signal),
  config: () => request<Config>("/config"),
  projects: () => request<Project[]>("/projects"),
  saveConfig: (body: unknown) => request<Config>("/config", "PUT", body),
  createProject: (name: string) =>
    request<Project>("/projects", "POST", { name }),
  updateProject: (project: Project, name: string, notes: string) =>
    request<Project>(`/projects/${project.id}`, "PATCH", {
      name,
      notes,
      updatedAt: project.updatedAt,
    }),
  renameProject: (project: Project, name: string) =>
    request<Project>(`/projects/${project.id}`, "PATCH", { name, updatedAt: project.updatedAt }),
  deleteProject: (project: Project) =>
    request(`/projects/${project.id}`, "DELETE", { updatedAt: project.updatedAt }),
  design: (id: string, signal?: AbortSignal) => request<WorkspaceView>(`/projects/${id}/design`, "GET", undefined, signal),
  patchContext: (id: string, patch: ContextPatch & { owner: RoleId }) =>
    request(`/projects/${id}/context`, "PATCH", patch),
  startRun: (id: string, prompt: string) =>
    request<AgentRun>(`/projects/${id}/runs`, "POST", { prompt }),
  stopRun: (id: string, runId: string) =>
    request(`/projects/${id}/runs/${runId}/stop`, "POST", {}),
  resumeRun: (id: string, runId: string) =>
    request(`/projects/${id}/runs/${runId}/resume`, "POST", {}),
  answerRun: (id: string, runId: string, answers: UserAnswer[]) =>
    request<AgentRun>(`/projects/${id}/runs/${runId}/answer`, "POST", { answers }),
  uploadEvidence: async (id: string, file: File, description: string) => {
    const query = new URLSearchParams({ name: file.name, description });
    const response = await fetch(`/api/projects/${id}/evidence?${query}`, {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || "Evidence upload failed");
    return value;
  },
  appearanceAction: (id: string, action: "confirm" | "revise" | "retry" | "cancel", body: unknown) => request(`/projects/${id}/appearance/${action}`, "POST", body),
  uploadReference: async (id: string, file: File, purpose: string) => {
    const response = await fetch(`/api/projects/${id}/appearance/references?${new URLSearchParams({purpose})}`, {method: "POST", headers: {"Content-Type": file.type || "application/octet-stream"}, body: file});
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || "Reference upload failed");
    return value as import("@harness/core").Artifact;
  },
  artifactUrl: (id: string, artifact: string) =>
    `/api/projects/${id}/artifacts/${artifact}`,
  exportUrl: (id: string) => `/api/projects/${id}/export`,
  diagnose: () => request<Diagnostic>("/runtime/diagnose", "POST", {}),
};
