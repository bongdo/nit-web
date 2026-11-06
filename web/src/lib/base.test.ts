import { describe, expect, it } from "vitest";
import { loginPath } from "./base";

describe("loginPath", () => {
  it("keeps the current path as next", () => {
    expect(loginPath("/nit/session?x=1")).toBe("/auth?next=%2Fnit%2Fsession%3Fx%3D1");
  });
});
