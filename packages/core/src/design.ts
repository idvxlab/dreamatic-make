/** Browser-safe product contracts. Geometry, sources and code are immutable artifacts. */
export const ROLES = [
  {
    id: "product",
    name: ["产品定义", "Product"],
    description: [
      "需求、功能、外观方向与验收标准",
      "Requirements, use cases and acceptance criteria",
    ],
  },
  {
    id: "hardware",
    name: ["硬件与零部件", "Hardware & Components"],
    description: [
      "选型、接口、BOM、采购与成本",
      "Components, interfaces, sourcing and BOM",
    ],
  },
  {
    id: "mechanical",
    name: ["外观与结构", "3D CAD & Mechanical"],
    description: [
      "形态、分件、参数化 CAD 与打印模型",
      "Product form, assembly and printable CAD",
    ],
  },
  {
    id: "firmware",
    name: ["固件与交互", "Firmware & Interaction"],
    description: [
      "驱动、交互、构建与烧录资料",
      "Drivers, interaction and firmware",
    ],
  },
  {
    id: "validation",
    name: ["集成与验证", "Integration & Validation"],
    description: [
      "机电集成、检查、问题与复测",
      "Integration, evidence and verification",
    ],
  },
  {
    id: "orchestrator",
    name: ["总控与协调", "Orchestrator"],
    description: [
      "任务、依赖、决策与版本协调",
      "Tasks, dependencies and decisions",
    ],
  },
  {
    id: "documentation",
    name: ["教程与文档", "Documentation"],
    description: [
      "装配、接线、烧录与故障排查",
      "Assembly, wiring and instructions",
    ],
  },
] as const;
export type RoleId = (typeof ROLES)[number]["id"];
export const roleIds: RoleId[] = ROLES.map((role) => role.id);
export type EntryStatus = "draft" | "ready" | "needs_review";
export interface ContextEntry {
  id: string;
  owner: RoleId;
  title: string;
  content: string;
  data: Record<string, unknown>;
  revision: number;
  status: EntryStatus;
  dependsOn: string[];
  artifactIds: string[];
  updatedAt: string;
  updatedBy: RoleId | "user";
}
export interface ContextChange {
  revision: number;
  at: string;
  actor: RoleId | "user" | "system";
  reason: string;
  entryId: string;
  before?: ContextEntry;
  after: ContextEntry;
  invalidated: string[];
}
export interface Artifact {
  id: string;
  name: string;
  owner: RoleId;
  kind: "source" | "cad" | "mesh" | "firmware" | "document" | "evidence" | "image";
  mediaType: string;
  bytes: number;
  sha256: string;
  createdAt: string;
  runId?: string;
  inputRevisions: Record<string, number>;
  sourceUrl?: string;
}
export interface DesignContext {
  schemaVersion: 1;
  projectId: string;
  revision: number;
  entries: ContextEntry[];
  changes: ContextChange[];
  artifacts: Artifact[];
}
export type RunStatus =
  | "queued"
  | "running"
  | "awaiting_input"
  | "partial"
  | "blocked"
  | "completed"
  | "failed"
  | "stopped"
  | "interrupted";
export interface SkillReceipt {
  name: string;
  path: string;
  sha256: string;
  rationale: string;
  loadedAt: string;
}
export interface AgentKnowledge {
  agentPath: string;
  agentSha256: string;
  promptSha256: string;
  skills: SkillReceipt[];
  references: Array<{ name: string; path: string; sha256: string }>;
}
export interface AgentTask {
  clarificationProposals?: Array<{question: string; options?: string[]; inputType?: QuestionInputType}>;
  contract?: import("./workflow.js").TaskContract;
  retryOf?: string;
  deliveryIssues?: string[];
  id: string;
  role: RoleId;
  instruction: string;
  status: RunStatus;
  inputRevisions: Record<string, number>;
  outputIds: string[];
  summary: string;
  needsReview: boolean;
  knowledge?: AgentKnowledge;
  startedAt: string;
  finishedAt?: string;
}
export interface RunEvent {
  id: number;
  at: string;
  type: "status" | "text" | "tool" | "context" | "error";
  role: RoleId;
  text: string;
}
export type QuestionInputType = "single" | "multiple" | "text";
export interface UserAnswer {
  selectedOptions?: string[];
  entryId: string;
  revision: number;
  answer: string;
}
export interface AgentRun {
  inheritedAnswers?: UserAnswer[];
  userAnswers?: UserAnswer[];
  id: string;
  projectId: string;
  role: RoleId;
  prompt: string;
  status: RunStatus;
  createdAt: string;
  finishedAt?: string;
  resumedFrom?: string;
  model?: {
    provider: string;
    modelId: string;
    protocol: string;
    configRevision: number;
  };
  tasks: AgentTask[];
  events: RunEvent[];
  error?: string;
}
export interface ProjectDesign {
  context: DesignContext;
  runs: AgentRun[];
}
export interface ContextPatch {
  id: string;
  baseRevision: number;
  title: string;
  content: string;
  data: Record<string, unknown>;
  dependsOn: string[];
  artifactIds: string[];
  status: "draft" | "ready";
  reason: string;
}
export function roleName(role: RoleId, language = "zh"): string {
  return ROLES.find((item) => item.id === role)!.name[
    language === "en" ? 1 : 0
  ];
}

export type WorkspaceView = {
  context: Omit<DesignContext, "changes"> & {
    changes: Array<
      Pick<
        ContextChange,
        "revision" | "at" | "actor" | "reason" | "entryId" | "invalidated"
      >
    >;
  };
  pendingInputRuns?: AgentRun[];
  runs: AgentRun[];
};
