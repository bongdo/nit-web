import { describe, expect, it } from "vitest";
import {
  cachedSessions,
  prefetchBoot,
  readBoot,
  seedBootSession,
  writeBoot,
} from "./bootCache";
import type { Model, Session } from "./types";

const session = (id: string, directory: string): Session => ({
  id,
  cost: 0,
  time: { created: 0, updated: 0 },
  location: { directory },
});

function mockFetch(instances: string[], calls: string[], offline = false) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const header = new Headers(init?.headers).get("X-Nit-Instance");
    if (header) instances.push(header);
    if (url.includes("/api/health") && offline) {
      return new Response(JSON.stringify({ ok: false, error: "down" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    const body = url.includes("/api/health")
      ? { ok: true, server: "s", version: "1" }
      : url.includes("/api/models")
        ? { data: [{ id: "m1" }] }
        : url.includes("/api/agents")
          ? { data: [{ id: "a1" }] }
          : url.includes("/api/projects")
            ? [{ id: "p1" }]
            : { data: [{ id: "s1" }], cursor: { next: null } };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

describe("boot cache", () => {
  it("starts empty and keeps earlier fields across writes", () => {
    expect(readBoot("boot-write")).toBeNull();

    writeBoot("boot-write", { health: { ok: true } });
    writeBoot("boot-write", { models: [{ id: "m1" }] as unknown as Model[] });

    const boot = readBoot("boot-write");
    expect(boot?.health).toEqual({ ok: true });
    expect(boot?.models).toHaveLength(1);
    expect(boot?.sessions).toEqual([]);
  });

  it("seeds a session once", () => {
    seedBootSession("boot-seed", session("x", "/work/nit"));
    seedBootSession("boot-seed", session("x", "/work/nit"));
    const boot = readBoot("boot-seed");
    expect(boot?.sessions).toHaveLength(1);
    expect(boot?.sessions[0]?.instance).toBe("boot-seed");
  });

  it("seeds chats per scope", () => {
    writeBoot("boot-scope", {
      sessions: [session("a", "/work/nit"), session("b", "/work/other")],
    });
    const boot = readBoot("boot-scope");
    expect(cachedSessions(boot, "mine", null, "frankfurt").map((item) => item.id)).toEqual([
      "a",
      "b",
    ]);
    expect(
      cachedSessions(boot, "everywhere", null, "frankfurt").map((item) => [
        item.id,
        item.instance,
      ]),
    ).toEqual([
      ["a", "frankfurt"],
      ["b", "frankfurt"],
    ]);
    expect(
      cachedSessions(boot, "directory", "/work/nit", "frankfurt").map((item) => item.id),
    ).toEqual(["a"]);
    expect(cachedSessions(null, "directory", "/work/nit", "frankfurt")).toEqual([]);
  });

  it("prefetches health, catalog and sessions once", async () => {
    const calls: string[] = [];
    const scoped: string[] = [];
    const restore = mockFetch(scoped, calls);
    try {
      await prefetchBoot("boot-prefetch");
      const boot = readBoot("boot-prefetch");
      expect(boot?.health?.ok).toBe(true);
      expect(boot?.models.map((item) => item.id)).toEqual(["m1"]);
      expect(boot?.agents.map((item) => item.id)).toEqual(["a1"]);
      expect(boot?.projects.map((item) => item.id)).toEqual(["p1"]);
      expect(boot?.sessions.map((item) => item.id)).toEqual(["s1"]);
      expect(scoped.every((item) => item === "boot-prefetch")).toBe(true);

      const before = calls.length;
      await prefetchBoot("boot-prefetch");
      expect(calls.length).toBe(before);
    } finally {
      restore();
    }
  });

  it("caches nothing when the instance is offline", async () => {
    const calls: string[] = [];
    const restore = mockFetch([], calls, true);
    try {
      await prefetchBoot("boot-offline");
      expect(readBoot("boot-offline")).toBeNull();
      expect(calls).toHaveLength(1);
    } finally {
      restore();
    }
  });
});
