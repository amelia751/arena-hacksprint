export type EnvCode = {
  init: string;
  legal_actions: string;
  observe: string;
  step: string;
  render: string;
};

export type EnvCodePatch = Partial<EnvCode>;

export type InfoFlowRow = {
  field: string;
  seats: Array<"visible" | "hidden" | "leak">;
};

export type CheckResult = {
  id: "V0" | "V1" | "V2" | "V3" | "V4" | "V5" | "V6" | "V7" | "V8";
  ok: boolean;
  summary: string;
  detail?: string;
};

export type ValidationReport = {
  ok: boolean;
  checks: CheckResult[];
  failures: string[];
  info_flow: InfoFlowRow[];
  playouts?: {
    n: number;
    steps: number;
    mean_length: number;
    balance: number[];
    ms: number;
  };
  sample_step?: Record<string, unknown>;
  render_coverage?: {
    seat: number;
    painted: string[];
    dark: string[];
    skipped: string[];
  };
};

export type Environment = {
  id: string;
  name: string;
  description: string;
  players: number;
  code: EnvCode;
  revision: number;
  code_hash: string;
  kind: "authored";
  published: boolean;
  confirmed_info_flow: boolean;
  validation: ValidationReport | null;
  created_at: string;
  updated_at: string;
};

export type Seat = {
  seat: number;
  player_type: "human" | "agent" | "bot";
  interface: "human_ui" | "webmcp" | "bot";
  agent_label?: string;
};

export type Match = {
  id: string;
  environment_id: string;
  environment_revision: number;
  environment_name: string;
  code_hash: string;
  seed: number;
  state: unknown;
  revision: number;
  terminal: boolean;
  rewards: number[];
  to_move: number;
  seats: Seat[];
  created_at: string;
  ended_at: string | null;
};

export type StepRecord = {
  type: "step";
  match_id: string;
  index: number;
  seat: number;
  revision: number;
  observation: unknown;
  legal_actions: string[];
  presented_order: number[];
  forced: boolean;
  action: string;
  reward: number;
  terminal: boolean;
  interface: Seat["interface"];
  latency_ms: number;
  rationale: string | null;
  confidence: number | null;
};

export type EpisodeHeader = {
  type: "episode";
  schema_version: "arena-1";
  match_id: string;
  environment: {
    id: string;
    revision: number;
    name: string;
    code_hash: string;
    validation: "pass" | "fail" | "unknown";
  };
  seed: number;
  seats: Seat[];
  returns: number[];
  length: number;
};

export const EMPTY_CODE: EnvCode = {
  init: "",
  legal_actions: "",
  observe: "",
  step: "",
  render: "",
};

export const CODE_KEYS: (keyof EnvCode)[] = [
  "init",
  "legal_actions",
  "observe",
  "step",
  "render",
];
