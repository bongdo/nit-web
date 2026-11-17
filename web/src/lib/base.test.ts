import { describe, expect, it } from "vitest";
import { loginPath, staleBundle } from "./base";

describe("loginPath", () => {
  it("keeps the current path as next", () => {
    expect(loginPath("/nit/session?x=1")).toBe("/auth?next=%2Fnit%2Fsession%3Fx%3D1");
  });
});

describe("staleBundle", () => {
  it("reloads only when the served index points at another entry script", () => {
    const html =
      '<script type="module" crossorigin src="/nit/assets/index-new.js"></script>';
    expect(staleBundle("/nit/assets/index-new.js", html)).toBe(false);
    expect(staleBundle("/nit/assets/index-old.js", html)).toBe(true);
    expect(staleBundle("/nit/assets/index-old.js", "<html></html>")).toBe(false);
    expect(staleBundle("", html)).toBe(false);
  });
});
