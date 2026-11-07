import { describe, expect, it } from "vitest";
import {
  ageLabel,
  openItems,
  parseSnooze,
  pendingCount,
  snoozeItem,
  stripFrontmatter,
  visibleItems,
} from "./review";
import type { ReviewItem } from "./types";

function item(id: string, status = "proposed"): ReviewItem {
  return { id, kind: "vision", status, title: id };
}

describe("review queue", () => {
  it("keeps only open items", () => {
    const items = [item("a"), item("b", "accepted"), item("c", "rejected"), item("d", "deferred")];
    expect(openItems(items).map((value) => value.id)).toEqual(["a", "d"]);
  });

  it("hides snoozed items until the snooze expires", () => {
    const items = [item("a"), item("b")];
    const snooze = snoozeItem({}, "a", 1_000);
    expect(visibleItems(items, snooze, 1_001).map((value) => value.id)).toEqual(["b"]);
    expect(visibleItems(items, snooze, 1_000 + 25 * 60 * 60 * 1000).map((value) => value.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("counts only visible open items", () => {
    const items = [item("a"), item("b"), item("c", "accepted")];
    const snooze = snoozeItem({}, "b", 0);
    expect(pendingCount(items, snooze, 0)).toBe(1);
  });

  it("parses only numeric snooze entries", () => {
    expect(parseSnooze(null)).toEqual({});
    expect(parseSnooze("nope")).toEqual({});
    expect(parseSnooze("[1,2]")).toEqual({});
    expect(parseSnooze('{"a":1,"b":"x","c":null}')).toEqual({ a: 1 });
  });

  it("returns stable age labels", () => {
    const now = 1_000 * 86_400_000;
    expect(ageLabel(undefined, now)).toBe("");
    expect(ageLabel(now / 1000, now)).toBe("today");
    expect(ageLabel(now / 1000 - 86_400, now)).toBe("1d");
    expect(ageLabel(now / 1000 - 3 * 86_400, now)).toBe("3d");
  });

  it("strips frontmatter from a vault note", () => {
    expect(stripFrontmatter("---\nid: x\nстатус: черновик\n---\n\n# X\n")).toBe("# X\n");
    expect(stripFrontmatter("# X\n")).toBe("# X\n");
    expect(stripFrontmatter("---\nid: x\n")).toBe("---\nid: x\n");
  });
});
