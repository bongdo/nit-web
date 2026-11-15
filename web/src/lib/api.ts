import type {
  Agent,
  Config,
  FolderListing,
  FormInfo,
  Health,
  InstanceInput,
  InstancesResponse,
  Message,
  MessagesResponse,
  Model,
  ModelRef,
  PermissionDecision,
  PermissionRequest,
  Project,
  ReviewQueue,
  Session,
  SessionList,
  UiState,
} from "./types";
import type { GrammarMatch } from "./spell";
import { appPath, loginPath } from "./base";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  instance?: string;
};

let instance = "";

export function setInstance(id: string) {
  instance = id;
}

export function getInstance(): string {
  return instance;
}

async function errorText(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: string; message?: string };
    return data.error || data.message || `Request failed (${response.status})`;
  } catch {
    const text = await response.text().catch(() => "");
    return text.trim().slice(0, 500) || `Request failed (${response.status})`;
  }
}

let redirecting = false;

function redirectToLogin() {
  if (redirecting) return;
  redirecting = true;
  window.location.assign(loginPath(window.location.pathname));
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const scoped = options.instance ?? instance;
  if (scoped) headers["X-Nit-Instance"] = scoped;
  const response = await fetch(appPath(path), {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal ?? AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    if (response.status === 401) redirectToLogin();
    let message = `Request failed (${response.status})`;
    try {
      const data = (await response.json()) as { error?: string; message?: string };
      message = data.error || data.message || message;
    } catch {
      const text = await response.text().catch(() => "");
      if (text.trim()) message = text.trim().slice(0, 500);
    }
    throw new ApiError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const SESSIONS_PAGE_SIZE = 100;

// shortcut: the API always requests 100 sessions per page; update if the server limit changes.
export function nextSessionCursor(page: SessionList): string | null {
  if (page.data.length < SESSIONS_PAGE_SIZE) return null;
  return page.cursor?.next ?? null;
}

const MAX_SESSION_PAGES = 100;

export const api = {
  setInstance,
  instances: (probe = false) =>
    request<InstancesResponse>(probe ? "/api/instances?probe=all" : "/api/instances"),
  saveInstance: (input: InstanceInput) =>
    request<{ ok: boolean }>("/api/instances", { method: "POST", body: input }),
  deleteInstance: (id: string) =>
    request<{ ok: boolean }>(`/api/instances/${encodeURIComponent(id)}`, { method: "DELETE" }),
  tts: (text: string, signal?: AbortSignal) =>
    request<{ ok: boolean; clients?: number }>("/api/tts", {
      method: "POST",
      body: { text },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : undefined,
    }),
  ttsStop: () => request<void>("/api/tts/stop", { method: "POST" }),
  ttsAudio: async (text: string, signal?: AbortSignal) => {
    const response = await fetch(appPath("/api/tts/audio"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(instance ? { "X-Nit-Instance": instance } : {}),
      },
      body: JSON.stringify({ text }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(120_000)])
        : AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new ApiError(await errorText(response), response.status);
    return response.blob();
  },
  health: (instance?: string) => request<Health>("/api/health", { instance }),
  config: () => request<Config>("/api/config"),
  projects: (instance?: string) => request<Project[]>("/api/projects", { instance }),
  folders: (path?: string, signal?: AbortSignal) =>
    request<FolderListing>(
      path ? `/api/fs?path=${encodeURIComponent(path)}` : "/api/fs",
      { signal },
    ),
  sessions: (
    dir?: string,
    children = false,
    search?: string,
    cursor?: string,
    instance?: string,
  ) => {
    const query = new URLSearchParams();
    if (dir) query.set("dir", dir);
    if (children) query.set("children", "true");
    if (search) query.set("search", search);
    if (cursor) query.set("cursor", cursor);
    const suffix = query.toString();
    return request<SessionList>(`/api/sessions${suffix ? `?${suffix}` : ""}`, { instance });
  },
  session: async (id: string) =>
    (await request<{ data: Session }>(`/api/sessions/${encodeURIComponent(id)}`)).data,
  allSessions: async (dir?: string, search?: string, instance?: string) => {
    const first = await api.sessions(dir, false, search, undefined, instance);
    const data = [...first.data];
    let cursor = nextSessionCursor(first);
    for (let page = 1; cursor && page < MAX_SESSION_PAGES; page += 1) {
      const next = await api.sessions(dir, false, search, cursor, instance);
      if (next.data.length === 0) break;
      data.push(...next.data);
      cursor = nextSessionCursor(next);
    }
    return data;
  },
  deleteSession: (id: string) =>
    request<void>(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),
  createSession: async (input: {
    directory?: string;
    title?: string;
    agent?: string;
    model?: ModelRef | null;
  }) => {
    const result = await request<{ data: Session }>("/api/sessions", {
      method: "POST",
      body: input,
    });
    return result.data;
  },
  messages: (id: string, options: { light?: boolean; limit?: number; before?: string } = {}) => {
    const query = new URLSearchParams();
    if (options.light) query.set("light", "1");
    if (options.limit) query.set("limit", String(options.limit));
    if (options.before) query.set("before", options.before);
    const suffix = query.toString();
    return request<MessagesResponse>(
      `/api/sessions/${encodeURIComponent(id)}/messages${suffix ? `?${suffix}` : ""}`,
    );
  },
  message: async (id: string, messageID: string) =>
    (
      await request<{ data: Message }>(
        `/api/sessions/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageID)}`,
      )
    ).data,
  children: async (id: string) =>
    (await request<SessionList>(`/api/sessions/${encodeURIComponent(id)}/children`)).data,
  prompt: (
    id: string,
    text: string,
    files?: { uri: string; name?: string }[],
    delivery?: "queue" | "steer",
    messageID?: string,
  ) =>
    request<unknown>(`/api/sessions/${encodeURIComponent(id)}/prompt`, {
      method: "POST",
      body: {
        text,
        ...(files && files.length > 0 ? { files } : {}),
        ...(delivery ? { delivery } : {}),
        ...(messageID ? { id: messageID } : {}),
      },
    }),
  interrupt: (id: string) =>
    request<{ interrupted?: boolean }>(`/api/sessions/${encodeURIComponent(id)}/interrupt`, {
      method: "POST",
    }),
  revert: (id: string, messageID: string) =>
    request<{ ok: boolean }>(`/api/sessions/${encodeURIComponent(id)}/revert`, {
      method: "POST",
      body: { messageID },
    }),
  fork: async (id: string, before?: string) =>
    (
      await request<{ data: Session }>(`/api/sessions/${encodeURIComponent(id)}/fork`, {
        method: "POST",
        body: { ...(before ? { before } : {}) },
      })
    ).data,
  compact: (id: string) =>
    request<{ ok: boolean }>(`/api/sessions/${encodeURIComponent(id)}/compact`, {
      method: "POST",
    }),
  forms: async (id: string) =>
    (await request<{ data: FormInfo[] }>(`/api/sessions/${encodeURIComponent(id)}/form`)).data,
  replyForm: (id: string, formID: string, answer: Record<string, unknown>) =>
    request<{ ok: boolean }>(
      `/api/sessions/${encodeURIComponent(id)}/form/${encodeURIComponent(formID)}/reply`,
      { method: "POST", body: { answer } },
    ),
  cancelForm: (id: string, formID: string, message?: string) =>
    request<void>(
      `/api/sessions/${encodeURIComponent(id)}/form/${encodeURIComponent(formID)}${
        message ? `?message=${encodeURIComponent(message)}` : ""
      }`,
      { method: "DELETE" },
    ),
  permissions: async (id: string) =>
    (
      await request<{ data: PermissionRequest[] }>(
        `/api/sessions/${encodeURIComponent(id)}/permissions`,
      )
    ).data,
  replyPermission: (
    id: string,
    requestID: string,
    decision: PermissionDecision,
    message?: string,
  ) =>
    request<unknown>(
      `/api/sessions/${encodeURIComponent(id)}/permissions/${encodeURIComponent(requestID)}/reply`,
      { method: "POST", body: { decision, ...(message ? { message } : {}) } },
    ),
  upload: async (file: File, dir: string) => {
    const query = new URLSearchParams({ name: file.name, dir });
    const response = await fetch(appPath(`/api/upload?${query}`), {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        ...(instance ? { "X-Nit-Instance": instance } : {}),
      },
      body: file,
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new ApiError(await errorText(response), response.status);
    return (await response.json()) as { path: string; name: string; size: number };
  },
  grammar: async (text: string) => {
    const result = await request<{ matches: GrammarMatch[] }>("/api/grammar", {
      method: "POST",
      body: { text },
      signal: AbortSignal.timeout(20_000),
    });
    return result.matches;
  },
  switchModel: (id: string, model: ModelRef) =>
    request<unknown>(`/api/sessions/${encodeURIComponent(id)}/model`, {
      method: "POST",
      body: { model },
    }),
  switchAgent: (id: string, agent: string) =>
    request<unknown>(`/api/sessions/${encodeURIComponent(id)}/agent`, {
      method: "POST",
      body: { agent },
    }),
  models: async (instance?: string) =>
    (await request<{ data: Model[] }>("/api/models", { instance })).data,
  agents: async (instance?: string) =>
    (await request<{ data: Agent[] }>("/api/agents", { instance })).data,
  review: (directory: string) =>
    request<ReviewQueue>(`/api/review?dir=${encodeURIComponent(directory)}`),
  doc: (directory: string, path: string) =>
    request<{ path: string; text: string }>(
      `/api/doc?dir=${encodeURIComponent(directory)}&path=${encodeURIComponent(path)}`,
    ),
  ui: (instance?: string) => request<UiState>("/api/ui", { instance }),
  setHidden: (ids: string[], hidden: boolean, instance?: string) =>
    request<{ ok: boolean; hidden: string[] }>("/api/ui/hidden", {
      method: "POST",
      body: { ids, hidden },
      instance,
    }),
  setShowHidden: (showHidden: boolean, instance?: string) =>
    request<{ ok: boolean; showHidden: boolean }>("/api/ui/show-hidden", {
      method: "POST",
      body: { showHidden },
      instance,
    }),
  setSessionStatus: (id: string, status: "" | "done" | "failed") =>
    request<{ ok: boolean }>(`/api/ui/sessions/${encodeURIComponent(id)}/status`, {
      method: "POST",
      body: { status },
    }),
  removeSessionState: (id: string) =>
    request<{ ok: boolean }>(`/api/ui/sessions/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  draft: (key: string, instance?: string) =>
    request<{ text: string; updatedAt: number }>(
      `/api/ui/drafts?key=${encodeURIComponent(key)}`,
      { instance },
    ),
  setDraft: (key: string, text: string, instance?: string) =>
    request<{ updatedAt: number }>("/api/ui/drafts", {
      method: "POST",
      body: { key, text },
      instance,
    }),
  setModel: (model: ModelRef | null) =>
    request<{ ok: boolean }>("/api/ui/model", { method: "POST", body: { model } }),
  setAgent: (agent: string) =>
    request<{ ok: boolean }>("/api/ui/agent", { method: "POST", body: { agent } }),
};
