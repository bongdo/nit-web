import { api } from "./api";
import type { Scope } from "./sessions";
import type { Agent, Health, Model, Project, Session } from "./types";

export type Boot = {
  health: Health | null;
  models: Model[];
  agents: Agent[];
  projects: Project[];
  sessions: Session[];
  at: number;
};

const cache = new Map<string, Boot>();
const inflight = new Map<string, Promise<void>>();

export function readBoot(instance: string): Boot | null {
  return cache.get(instance) ?? null;
}

export function writeBoot(instance: string, patch: Partial<Omit<Boot, "at">>): void {
  cache.set(instance, {
    health: null,
    models: [],
    agents: [],
    projects: [],
    sessions: [],
    ...cache.get(instance),
    ...patch,
    at: Date.now(),
  });
}

export function prefetchBoot(instance: string): Promise<void> {
  if (cache.has(instance)) return Promise.resolve();
  const running = inflight.get(instance);
  if (running) return running;
  const task = (async () => {
    try {
      const health = await api.health(instance);
      if (!health.ok) return;
      writeBoot(instance, { health });
      const [models, agents, projects, sessions] = await Promise.allSettled([
        api.models(instance),
        api.agents(instance),
        api.projects(instance),
        api.allSessions(undefined, undefined, instance),
      ]);
      writeBoot(instance, {
        ...(models.status === "fulfilled" ? { models: models.value } : {}),
        ...(agents.status === "fulfilled" ? { agents: agents.value } : {}),
        ...(projects.status === "fulfilled" ? { projects: projects.value } : {}),
        ...(sessions.status === "fulfilled" ? { sessions: sessions.value } : {}),
      });
    } catch {
    } finally {
      inflight.delete(instance);
    }
  })();
  inflight.set(instance, task);
  return task;
}

export function cachedSessions(
  boot: Boot | null,
  scope: Scope,
  workspace: string | null,
  instance: string,
): Session[] {
  if (!boot) return [];
  if (scope === "everywhere")
    return boot.sessions.map((session) => ({ ...session, instance }));
  if (scope === "directory" && workspace)
    return boot.sessions.filter((session) => session.location?.directory === workspace);
  return boot.sessions;
}
