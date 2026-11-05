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
  uri: string;
  name?: string;
  description?: string;
  mime?: string;
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
};

export type ToolPart = {
  type: "tool";
  id: string;
  name: string;
  executed?: boolean;
  state: ToolState;
  time?: { created?: number; ran?: number; completed?: number };
};

export type Part = TextPart | ReasoningPart | ToolPart;

export type MessageError = {
  name?: string;
  message?: string;
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
  files?: { uri?: string; name?: string }[];
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

export type SessionList = { data: Session[] };
export type MessagesResponse = { data: Message[] };

export type Model = {
  id: string;
  modelID: string;
  providerID: string;
  name: string;
  status: string;
  enabled: boolean;
  variants: { id: string }[];
  cost: {
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
};

export type Health = {
  ok: boolean;
  server?: string;
  version?: string;
  error?: string;
};

export type StreamEvent = {
  id?: string;
  created?: number;
  type: string;
  location?: { directory?: string };
  data: Record<string, unknown>;
};
