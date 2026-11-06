import { describe, expect, it } from "vitest";
import { addInstanceParam, instanceScopedKey, mergeDeviceCapabilities } from "./instances";
import type { InstanceCapability } from "./types";

describe("instances", () => {
  it("scopes local storage keys except on the default instance", () => {
    expect(instanceScopedKey("nit-gui.workspace", "frankfurt", "frankfurt")).toBe(
      "nit-gui.workspace",
    );
    expect(instanceScopedKey("nit-gui.workspace", "laptop", "frankfurt")).toBe(
      "nit-gui.workspace:laptop",
    );
    expect(instanceScopedKey("nit-gui.session", "", "frankfurt")).toBe("nit-gui.session");
  });

  it("adds an instance query parameter and keeps the query and hash", () => {
    expect(addInstanceParam("/api/file?path=%2Ftmp%2Fa.pdf", "laptop")).toBe(
      "/api/file?path=%2Ftmp%2Fa.pdf&instance=laptop",
    );
    expect(addInstanceParam("/api/file?path=%2Ftmp%2Fa.pdf#page=2", "laptop")).toBe(
      "/api/file?path=%2Ftmp%2Fa.pdf&instance=laptop#page=2",
    );
    expect(addInstanceParam("/api/events", "laptop")).toBe("/api/events?instance=laptop");
    expect(addInstanceParam("/api/events#top", "laptop")).toBe("/api/events?instance=laptop#top");
    expect(addInstanceParam("/api/events?x=1", "")).toBe("/api/events?x=1");
  });

  it("downgrades host speech to the device voice fallback", () => {
    const caps: InstanceCapability[] = [
      { id: "chat", label: "Chat", owner: "opencode", state: "on", required: true },
      { id: "speech", label: "Speech", owner: "opencode", state: "off", detail: "no host TTS" },
      { id: "grammar", label: "Grammar", owner: "nit-gui", state: "off", detail: "none" },
    ];
    const merged = mergeDeviceCapabilities(caps, true);
    expect(merged[0]).toEqual(caps[0]);
    expect(merged[1]).toEqual({
      id: "speech",
      label: "Speech",
      owner: "browser",
      state: "fallback",
      detail: "device voice; host TTS not connected",
    });
    expect(merged[2]).toEqual(caps[2]);
    expect(mergeDeviceCapabilities(caps, false)).toEqual(caps);
    expect(mergeDeviceCapabilities([{ ...caps[1], state: "on" }], true)[0]).toMatchObject({
      state: "on",
      owner: "opencode",
    });
  });
});
