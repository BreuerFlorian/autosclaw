export type AgentStatus = "starting" | "running" | "stopping" | "stopped" | "deleted";

export type UserRole = "admin" | "member" | "viewer";

export type AgentPermission = "agent:spawn" | "agent:schedule";

export type Agent = {
  id: string;
  name: string;
  purpose: string;
  status: AgentStatus;
  processing: boolean;
  waitingForAskUser: boolean;
  costUSD: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  createdBy: number | null;
  permissions?: string[];
  projectId?: string | null;
};

export type Schedule = {
  id: string;
  name: string;
  cron_expression: string;
  schedule_type: "recurring" | "once";
  status: "active" | "paused";
  agent_name: string;
  agent_purpose: string;
  agent_system_prompt: string;
  agent_permissions: string;
  next_run_at: string | null;
  last_run_at: string | null;
  created_by: number | null;
  project_id?: string | null;
};

export type Project = {
  id: string;
  name: string;
  purpose: string;
  github_token: string; // masked: first 6 chars + ******
  status: "active" | "deleted";
  created_at: string;
  updated_at: string;
  created_by: number | null;
};

export type AskQuestion = {
  header?: string;
  question: string;
  options: Array<{ label: string; description?: string }>;
};

export type OutputEntry =
  | { kind: "output"; msgType: string; content: string; timestamp: string }
  | { kind: "text_entry"; role: "user" | "assistant"; text: string; timestamp: string }
  | { kind: "tool_use"; toolType: string; name: string; input: unknown; timestamp: string }
  | { kind: "ask_user"; questions: AskQuestion[]; answered: boolean; timestamp: string };

export type ModalType = "newAgent" | "newSchedule" | null;

export type AppState = {
  agents: Agent[];
  schedules: Schedule[];
  projects: Project[];
  currentAgentId: string | null;
  currentScheduleId: string | null;
  outputs: OutputEntry[];
  sidebarOpen: boolean;
  modal: ModalType;
};

export type AppAction =
  | { type: "SET_AGENTS"; agents: Agent[] }
  | { type: "SET_SCHEDULES"; schedules: Schedule[] }
  | { type: "SET_PROJECTS"; projects: Project[] }
  | { type: "SELECT_AGENT"; agentId: string }
  | { type: "DESELECT_AGENT" }
  | { type: "SELECT_SCHEDULE"; scheduleId: string }
  | { type: "DESELECT_SCHEDULE" }
  | { type: "ADD_OUTPUT"; entry: OutputEntry }
  | { type: "SET_OUTPUTS"; entries: OutputEntry[] }
  | { type: "CLEAR_OUTPUTS" }
  | { type: "MARK_ASK_ANSWERED"; index: number }
  | { type: "REMOVE_UNANSWERED_ASKS" }
  | { type: "TOGGLE_SIDEBAR" }
  | { type: "CLOSE_SIDEBAR" }
  | { type: "SET_MODAL"; modal: ModalType };

export type WsSendFn = (msg: Record<string, unknown>) => void;
