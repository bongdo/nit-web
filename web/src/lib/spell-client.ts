import type { SpellIssue } from "./spell";

type Response =
  | { type: "ready" }
  | { type: "issues"; id: number; issues: SpellIssue[] }
  | { type: "completion"; id: number; words: string[] }
  | { type: "learned"; id: number; words: string[] }
  | { type: "error"; message: string };

type Pending = {
  resolve: (value: SpellIssue[] | string[]) => void;
  reject: (error: Error) => void;
};

let worker: Worker | null = null;
let starting: Promise<void> | null = null;
let broken = false;
let failedAt = 0;
let sequence = 0;
const pending = new Map<number, Pending>();

export const RESTART_GUARD_MS = 30_000;

export function restartAllowed(failedAt: number, now: number): boolean {
  return failedAt === 0 || now - failedAt >= RESTART_GUARD_MS;
}

function stop(error: Error) {
  broken = true;
  failedAt = Date.now();
  worker?.terminate();
  worker = null;
  starting = null;
  for (const item of pending.values()) item.reject(error);
  pending.clear();
}

function start(): Promise<void> {
  if (broken) {
    if (!restartAllowed(failedAt, Date.now())) {
      return Promise.reject(new Error("spellcheck unavailable"));
    }
    broken = false;
  }
  if (starting) return starting;
  starting = new Promise<void>((resolve, reject) => {
    try {
      worker = new Worker(new URL("./spell.worker.ts", import.meta.url), { type: "module" });
    } catch (error) {
      reject(error instanceof Error ? error : new Error("spellcheck worker failed"));
      return;
    }
    worker.onmessage = (event: MessageEvent<Response>) => {
      const data = event.data;
      if (data.type === "ready") {
        resolve();
        return;
      }
      if (data.type === "error") {
        reject(new Error(data.message));
        stop(new Error(data.message));
        return;
      }
      const item = pending.get(data.id);
      if (!item) return;
      pending.delete(data.id);
      item.resolve(data.type === "issues" ? data.issues : data.words);
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || "spellcheck worker failed");
      reject(error);
      stop(error);
    };
  }).catch((error: unknown) => {
    if (!broken) {
      broken = true;
      failedAt = Date.now();
    }
    starting = null;
    throw error;
  });
  return starting;
}

function request<T>(message: Record<string, unknown>): Promise<T> {
  return start()
    .then(() => {
      if (!worker) return [] as T;
      const id = ++sequence;
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error("spellcheck timed out"));
        }, 15_000);
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value as T);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        worker?.postMessage({ ...message, id });
      });
    })
    .catch(() => [] as T);
}

export function preloadSpellcheck(): Promise<void> {
  return start().catch(() => undefined);
}

export function checkSpelling(text: string, ignore: string[]): Promise<SpellIssue[]> {
  return request<SpellIssue[]>({ kind: "issues", text, ignore });
}

export function completeSpelling(prefix: string, ignore: string[]): Promise<string[]> {
  return request<string[]>({ kind: "completion", prefix, ignore });
}

export function learnWords(text: string, ignore: string[]): Promise<string[]> {
  return request<string[]>({ kind: "learn", text, ignore });
}
