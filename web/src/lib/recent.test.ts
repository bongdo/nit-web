import { beforeEach, describe, expect, it, vi } from "vitest";
import { addRecent, readRecent } from "./recent";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

describe("recent workspaces", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
  });

  it("keeps the newest folder once and caps the list", () => {
    for (let index = 0; index < 10; index += 1) addRecent("local", "local", `/w/${index}`);
    expect(addRecent("local", "local", "/w/9/")).toEqual([
      "/w/9",
      "/w/8",
      "/w/7",
      "/w/6",
      "/w/5",
      "/w/4",
      "/w/3",
      "/w/2",
    ]);
  });

  it("reads only strings and nothing without an instance", () => {
    localStorage.setItem("nit-gui.recent", JSON.stringify(["/a", 3, "/b"]));
    expect(readRecent("local", "local")).toEqual(["/a", "/b"]);
    expect(readRecent("", "local")).toEqual([]);
  });

  it("survives broken json", () => {
    localStorage.setItem("nit-gui.recent", "{");
    expect(readRecent("local", "local")).toEqual([]);
  });
});
