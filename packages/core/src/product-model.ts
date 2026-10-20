/** Browser-safe projections of the Python engine. SI units; no CAD or Python runtime here. */
export const PRODUCT_MODEL_ENTRY = "mechanical.product_model";
export type ModelPose = { translation_m: [number, number, number]; rotation_xyzw: [number, number, number, number] };
export interface ModelDiagnostic { code?: string; severity?: string; outcome?: string; message: string; object_refs?: string[] }
export interface ModelSample { value: number | boolean | string | null; quality: string; origin: string; time_s: number }
export interface ModelFrame {
  time_s: number; body_poses: Record<string, ModelPose>;
  joint_positions: Record<string, number>; joint_velocities: Record<string, number>;
  network_samples: Record<string, ModelSample>; behavior_outputs: Record<string, ModelSample>;
  sensor_samples: Record<string, ModelSample>; effects: Record<string, ModelSample>;
  collisions: [string, string][];
}
export type ModelShape = { kind: "box"; size_m: [number, number, number] }
  | { kind: "sphere"; radius_m: number }
  | { kind: "cylinder"; radius_m: number; length_m: number }
  | { kind: "capsule"; radius_m: number; segment_length_m: number }
  | { kind: "convex_asset"; asset_ref: unknown };
export interface ModelWorkspace {
  snapshot_id: string; input_revisions: Record<string, number>; diagnostics: ModelDiagnostic[];
  preview_status: string;
  scene: {
    bodies: { entity_ref: string; world_pose: ModelPose | null }[];
    envelopes: { entity_ref: string; body_ref: string; pose: ModelPose; shape: ModelShape; purpose: string; margin_m: number }[];
    joints: { entity_ref: string; parent: string; child: string; kind: string; axis: number[]; position_si: number | null }[];
    collisions: [string, string][];
  };
  circuit: {
    terminals: { entity_ref: string; net_ref: string | null }[];
    nets: { entity_ref: string; members: string[]; kind: string; sample: ModelSample | null }[];
    behaviors: { entity_ref: string; model_id: string; inputs: Record<string, { source_entity_ref: string | null; channel?: string }>; sample: ModelSample | null }[];
  };
  flow: { mode: "topology_only"; ports: { entity_ref: string }[];
    paths: { entity_ref: string; inlet_ref: string; outlet_ref: string }[];
    connections: { entity_ref: string; a: string; b: string }[] };
  result: null | { status: string; snapshot_id: string; scenario_hash: string; actual_end_s: number;
    coverage: string[]; diagnostics: ModelDiagnostic[]; frames: ModelFrame[] };
}
export interface ProductModelResponse {
  workspace: ModelWorkspace; sourceRevision: number; demo: boolean;
  resultArtifactId?: string; stale?: boolean;
}
