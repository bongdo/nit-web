import { access, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function findBrowser() {
  if (process.env.NIT_PREVIEW_BROWSER) return process.env.NIT_PREVIEW_BROWSER;
  for (const path of [
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
  ]) {
    if (await exists(path)) return path;
  }
  const root = join(homedir(), ".cache/ms-playwright");
  const found = [];
  for (const dir of (await readdir(root).catch(() => [])).filter((name) =>
    name.startsWith("chromium-"),
  )) {
    const base = join(root, dir);
    for (const arch of await readdir(base).catch(() => [])) {
      if (!arch.startsWith("chrome-linux")) continue;
      const exe = join(base, arch, "chrome");
      if (await exists(exe)) found.push(exe);
    }
  }
  return found.sort().pop();
}
