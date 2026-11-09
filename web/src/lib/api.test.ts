import { describe, expect, it } from "vitest";
import { nextSessionCursor, SESSIONS_PAGE_SIZE } from "./api";
import type { Session, SessionList } from "./types";

const page = (count: number, next: string | null = "c"): SessionList => ({
  data: Array.from({ length: count }, () => ({}) as Session),
  cursor: { next },
});

describe("nextSessionCursor", () => {
  it("drops the cursor when the page is not full", () => {
    expect(nextSessionCursor(page(SESSIONS_PAGE_SIZE - 1))).toBeNull();
    expect(nextSessionCursor({ data: [] })).toBeNull();
  });

  it("keeps the cursor while pages stay full", () => {
    expect(nextSessionCursor(page(SESSIONS_PAGE_SIZE))).toBe("c");
    expect(nextSessionCursor(page(SESSIONS_PAGE_SIZE, null))).toBeNull();
  });
});
