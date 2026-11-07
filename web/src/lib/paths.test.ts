import { describe, expect, it } from "vitest";
import { joinPath, normalizePath, parentPath, pathCrumbs, splitPathInput } from "./paths";

describe("paths", () => {
  it("normalizes separators and dot segments", () => {
    expect(normalizePath("/home/ubuntu/")).toBe("/home/ubuntu");
    expect(normalizePath("/home//ubuntu/./work/..")).toBe("/home/ubuntu");
    expect(normalizePath("/")).toBe("/");
  });

  it("walks to the parent folder", () => {
    expect(parentPath("/home/ubuntu")).toBe("/home");
    expect(parentPath("/home")).toBe("/");
    expect(parentPath("/")).toBe("/");
  });

  it("splits the typed path into the folder to list and the prefix", () => {
    expect(splitPathInput("")).toEqual({ dir: "", prefix: "" });
    expect(splitPathInput("/")).toEqual({ dir: "/", prefix: "" });
    expect(splitPathInput("/home/ubun")).toEqual({ dir: "/home", prefix: "ubun" });
    expect(splitPathInput("/home/ubuntu/Proj")).toEqual({
      dir: "/home/ubuntu",
      prefix: "Proj",
    });
    expect(splitPathInput("/home/ubuntu/")).toEqual({ dir: "/home/ubuntu", prefix: "" });
    expect(splitPathInput("relative/dir")).toEqual({ dir: "", prefix: "relative/dir" });
  });

  it("joins and splits paths for breadcrumbs", () => {
    expect(joinPath("/", "home")).toBe("/home");
    expect(joinPath("/home", "ubuntu")).toBe("/home/ubuntu");
    expect(pathCrumbs("/home/ubuntu")).toEqual([
      { label: "/", path: "/" },
      { label: "home", path: "/home" },
      { label: "ubuntu", path: "/home/ubuntu" },
    ]);
  });
});
