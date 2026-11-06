import type {
  Agent,
  Config,
  FormInfo,
  Health,
  MessagesResponse,
  Model,
  ModelRef,
  Project,
  Session,
  SessionList,
} from "./types";
import type { GrammarMatch } from "./spell";

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
};

async function errorText(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: string; message?: string };
    return data.error || data.message || `Request failed (${response.status})`;
  } catch {
    const text = await response.text().catch(() => "");
    return text.trim().slice(0, 500) || `Request failed (${response.status})`;
  }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal ?? AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
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

export const api = {
  health: () => request<Health>("/api/health"),
  config: () => request<Config>("/api/config"),
  projects: () => request<Project[]>("/api/projects"),
  sessions: (dir?: string) => {
    const query = new URLSearchParams();
    if (dir) query.set("dir", dir);
    const suffix = query.toString();
    return request<SessionList>(`/api/sessions${suffix ? `?${suffix}` : ""}`);
  },
  session: async (id: string) =>
    (await request<{ data: Session }>(`/api/sessions/${encodeURIComponent(id)}`)).data,
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
  messages: async (id: string) =>
    (await request<MessagesResponse>(`/api/sessions/${encodeURIComponent(id)}/messages`)).data,
  children: async (id: string) =>
    (await request<SessionList>(`/api/sessions/${encodeURIComponent(id)}/children`)).data,
  prompt: (
    id: string,
    text: string,
    files?: { uri: string; name?: string }[],
    delivery?: "queue" | "steer",
  ) =>
    request<unknown>(`/api/sessions/${encodeURIComponent(id)}/prompt`, {
      method: "POST",
      body: {
        text,
        ...(files && files.length > 0 ? { files } : {}),
        ...(delivery ? { delivery } : {}),
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
  upload: async (file: File, dir: string) => {
    const query = new URLSearchParams({ name: file.name, dir });
    const response = await fetch(`/api/upload?${query}`, {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new ApiError(await errorText(response), response.status);
    return (await response.json()) as { path: string; name: string; size: number };
  },
  stt: async (audio: Blob, mode?: "fast") => {
    const response = await fetch(`/api/stt${mode ? `?mode=${mode}` : ""}`, {
      method: "POST",
      headers: { "Content-Type": "audio/wav" },
      body: audio,
      signal: AbortSignal.timeout(180_000),
    });
    if (!response.ok) throw new ApiError(await errorText(response), response.status);
    return (await response.json()) as { text: string };
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
  models: async () => (await request<{ data: Model[] }>("/api/models")).data,
  agents: async () => (await request<{ data: Agent[] }>("/api/agents")).data,
};
