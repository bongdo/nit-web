import type {
  Agent,
  Config,
  Health,
  MessagesResponse,
  Model,
  ModelRef,
  Session,
  SessionList,
} from "./types";

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
  sessions: (dir?: string) =>
    request<SessionList>(`/api/sessions${dir ? `?dir=${encodeURIComponent(dir)}` : ""}`),
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
  prompt: (id: string, text: string) =>
    request<unknown>(`/api/sessions/${encodeURIComponent(id)}/prompt`, {
      method: "POST",
      body: { text },
    }),
  interrupt: (id: string) =>
    request<{ interrupted?: boolean }>(`/api/sessions/${encodeURIComponent(id)}/interrupt`, {
      method: "POST",
    }),
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
