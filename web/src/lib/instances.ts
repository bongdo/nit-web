import type { InstanceCapability } from "./types";

export const APP_NAME = "nit-gui 2";

export function appLabel(host: string): string {
  if (!host) return APP_NAME;
  return `${APP_NAME} — ${host.charAt(0).toUpperCase()}${host.slice(1)}`;
}

export function instanceScopedKey(base: string, instance: string, defaultInstance: string): string {
  return !instance || instance === defaultInstance ? base : `${base}:${instance}`;
}

export function addInstanceParam(href: string, id: string): string {
  if (!id) return href;
  const hashIndex = href.indexOf("#");
  const path = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : href.slice(hashIndex);
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}instance=${encodeURIComponent(id)}${hash}`;
}

export function streamDelta(
  previous: string[],
  next: string[],
): { open: string[]; close: string[] } {
  const before = new Set(previous);
  const after = new Set(next);
  return {
    open: next.filter((id) => !before.has(id)),
    close: previous.filter((id) => !after.has(id)),
  };
}

export function mergeDeviceCapabilities(
  caps: InstanceCapability[],
  supportsSpeech: boolean,
): InstanceCapability[] {
  return caps.map((cap) => {
    if (cap.id !== "speech") return cap;
    if (cap.state === "off" && supportsSpeech)
      return {
        ...cap,
        state: "fallback",
        owner: "browser",
        detail: "device voice; host TTS not connected",
      };
    if (cap.state === "fallback" && supportsSpeech)
      return {
        ...cap,
        state: "fallback",
        owner: "browser",
        detail: "device voice; host TTS has no audio client",
      };
    if (cap.state === "fallback" && !supportsSpeech)
      return {
        ...cap,
        state: "off",
        owner: "opencode",
        detail: "host TTS hub up · no audio client; no device voice",
      };
    return cap;
  });
}
