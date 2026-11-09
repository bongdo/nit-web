export type ModelRef = {
  id: string;
  providerID: string;
  variant?: string;
};

export type Tokens = {
  input?: number;
  output?: number;
  reasoning?: number;
  cache?: { read?: number; write?: number };
};

export type UserFile = {
  uri?: string;
  source?: { uri?: string };
  name?: string;
  description?: string;
  mime?: string;
  data?: string;
  bytes?: number;
};

export type FormOption = {
  value: string;
  label: string;
  description?: string;
};

export type FormField = {
  key: string;
  type: string;
  title?: string;
  description?: string;
  placeholder?: string;
  url?: string;
  required?: boolean;
  hidden?: boolean;
  custom?: boolean;
  default?: unknown;
  options?: FormOption[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  when?: { key: string; op: "eq" | "neq"; value: unknown }[];
};

export type FormInfo = {
  id: string;
  sessionID: string;
  title: string;
  metadata?: Record<string, unknown>;
  fields: FormField[];
};

export type PermissionDecision = "once" | "always" | "reject";

export type PermissionRequest = {
  id: string;
  sessionID: string;
  action: string;
  resources: string[];
  save?: string[];
  metadata?: Record<string, unknown>;
  source?: unknown;
  message?: string;
};

export type ToolContent = {
  type: string;
  text?: string;
  uri?: string;
  url?: string;
  mime?: string;
  name?: string;
};

export type ToolState = {
  status: "streaming" | "running" | "completed" | "error";
  input?: unknown;
  content?: ToolContent[];
  metadata?: Record<string, unknown>;
  error?: { name?: string; message?: string };
};

export type TextPart = {
  type: "text";
  text: string;
  ordinal?: number;
};

export type ReasoningPart = {
  type: "reasoning";
  text: string;
  ordinal?: number;
  light?: boolean;
};

export type ToolPart = {
  type: "tool";
  id: string;
  name: string;
  executed?: boolean;
  state: ToolState;
  time?: { created?: number; ran?: number; completed?: number };
  light?: boolean;
};

export type Part = TextPart | ReasoningPart | ToolPart;

export type EditedFile = {
  path: string;
  status?: string;
  additions?: number;
  deletions?: number;
};

export type MessageError = {
  name?: string;
  message?: string;
  type?: string;
  status?: number;
  retryAfterMs?: number;
};

export type Message = {
  id: string;
  type: string;
  time: { created: number; streamed?: number; completed?: number };
  text?: string;
  files?: UserFile[];
  content?: Part[];
  agent?: string;
  model?: ModelRef;
  cost?: number;
  tokens?: Tokens;
  outcome?: string;
  error?: MessageError;
  finish?: string;
  command?: string;
  status?: string;
  exit?: number | string;
  output?: { output: string; truncated?: boolean };
  steps?: number;
  tools?: number;
  errors?: number;
  edited?: EditedFile[];
  name?: string;
  description?: string;
  summary?: string;
  reason?: string;
};

export type Project = {
  id: string;
  canonical: string;
  vcs?: string;
  time: { created: number; updated: number; active: number };
};

export type FolderListing = {
  path: string;
  parent: string;
  dirs: string[];
  truncated?: boolean;
};

export type Session = {
  id: string;
  parentID?: string;
  projectID?: string;
  title?: string;
  agent?: string;
  model?: ModelRef;
  cost: number;
  tokens?: Tokens;
  outcome?: string;
  time: {
    created: number;
    updated: number;
    busy?: number;
    idle?: number;
    viewed?: number;
    archived?: number;
  };
  location: { directory: string };
};

export type SessionList = {
  data: Session[];
  cursor?: { next?: string | null; previous?: string | null } | null;
};
export type MessagesResponse = { data: Message[]; previous?: string | null };
export type UiState = {
  hidden: string[];
  status: Record<string, string>;
  model: ModelRef | null;
  agent: string | null;
};

export type Model = {
  id: string;
  modelID: string;
  providerID: string;
  name: string;
  status: string;
  enabled: boolean;
  capabilities?: { input?: string[] };
  variants: { id: string }[];
  cost: {
    tier?: { type: string; size: number };
    input: number;
    output: number;
    cache: { read: number; write: number };
  }[];
  limit: { context: number; output: number };
};

export type Agent = {
  id: string;
  name: string;
  description?: string;
  mode: "subagent" | "primary" | "all" | string;
  hidden: boolean;
  model?: ModelRef;
};

export type Config = {
  directory: string;
  model: ModelRef | null;
  agent: string | null;
  peroURL: string;
  termURL: string;
  transport: string;
};

export type Health = {
  ok: boolean;
  server?: string;
  version?: string;
  error?: string;
  instance?: string;
};

export type CapabilityState = "on" | "fallback" | "off" | "unknown";

export type InstanceTransport = "local" | "url" | "ssh";

export type InstanceInput = {
  original?: string;
  name: string;
  transport: InstanceTransport;
  url?: string;
  ssh?: string;
  dir?: string;
  password?: string;
  passwordFile?: string;
};

export type InstanceCapability = {
  id: string;
  label: string;
  owner: string;
  state: CapabilityState;
  required?: boolean;
  detail?: string;
};

export type Instance = {
  id: string;
  name: string;
  transport: InstanceTransport;
  detail: string;
  state: "connected" | "offline" | "unknown";
  error?: string;
  opencode?: { ok: boolean; version?: string; server?: string };
  url?: string;
  ssh?: string;
  defaultDirectory?: string;
  capabilities: InstanceCapability[];
};

export type InstancesResponse = {
  app: { name: string; host: string; version: string };
  default: string;
  configPath?: string;
  configError?: string;
  instances: Instance[];
};

export type StreamEvent = {
  id?: string;
  created?: number;
  type: string;
  location?: { directory?: string };
  data: Record<string, unknown>;
};

export type ReviewKind = "vision" | "feature";

export type ReviewItem = {
  id: string;
  kind: ReviewKind;
  status: string;
  title: string;
  quote?: string;
  source?: string;
  note?: string;
  body?: string;
  created?: number;
};

export type ReviewQueue = {
  updated?: number;
  items: ReviewItem[];
};
