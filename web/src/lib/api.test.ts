import { describe, expect, it } from "vitest";
import { api, nextSessionCursor, SESSIONS_PAGE_SIZE } from "./api";
import type { Session, SessionList } from "./types";

const page = (count: number, next: string | null = "c"): SessionList => ({
  data: Array.from({ length: count }, () => ({}) as Session),
  cursor: { next },
});

describe("allSessions", () => {
  it("follows the cursor until a short page", async () => {
    const calls: string[] = [];
    const pages = [page(SESSIONS_PAGE_SIZE, "c1"), page(SESSIONS_PAGE_SIZE, "c2"), page(3, null)];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(JSON.stringify(pages.shift()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const data = await api.allSessions(undefined, "q");
      expect(data).toHaveLength(SESSIONS_PAGE_SIZE * 2 + 3);
      expect(calls[0]).not.toContain("cursor=");
      expect(calls[1]).toContain("cursor=c1");
      expect(calls[2]).toContain("cursor=c2");
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("instance scoping", () => {
  it("sends the instance header for every page", async () => {
    const headers: (string | null)[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      headers.push(new Headers(init?.headers).get("X-Nit-Instance"));
      return new Response(JSON.stringify(page(1, null)), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    try {
      await api.allSessions(undefined, undefined, "riga");
      expect(headers).toEqual(["riga"]);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("nextSessionCursor", () => {  it("drops the cursor when the page is not full", () => {
    expect(nextSessionCursor(page(SESSIONS_PAGE_SIZE - 1))).toBeNull();
    expect(nextSessionCursor({ data: [] })).toBeNull();
  });

  it("keeps the cursor while pages stay full", () => {
    expect(nextSessionCursor(page(SESSIONS_PAGE_SIZE))).toBe("c");
    expect(nextSessionCursor(page(SESSIONS_PAGE_SIZE, null))).toBeNull();
  });
});
