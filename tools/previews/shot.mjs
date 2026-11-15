import { chromium } from "playwright-core";
import { access, mkdir, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const base = process.env.NIT_GATE_URL || "http://127.0.0.1:8090";
const out = process.env.NIT_GATE_PREVIEWS || join(homedir(), ".local/state/nit-gui/gate/previews");
const prefixes = (process.env.NIT_PREVIEWS || "nit,pero,term,share").split(",").filter(Boolean);

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function findBrowser() {
  if (process.env.NIT_PREVIEW_BROWSER) return process.env.NIT_PREVIEW_BROWSER;
  for (const path of ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"]) {
    if (await exists(path)) return path;
  }
  const root = join(homedir(), ".cache/ms-playwright");
  const found = [];
  for (const dir of (await readdir(root).catch(() => [])).filter((name) => name.startsWith("chromium-"))) {
    const base = join(root, dir);
    for (const arch of await readdir(base).catch(() => [])) {
      if (!arch.startsWith("chrome-linux")) continue;
      const exe = join(base, arch, "chrome");
      if (await exists(exe)) found.push(exe);
    }
  }
  return found.sort().pop();
}

const executablePath = await findBrowser();
if (!executablePath) {
  console.error("previews: no chromium found; set NIT_PREVIEW_BROWSER");
  process.exit(1);
}

await mkdir(out, { recursive: true });

const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
const context = await browser.newContext({
  viewport: { width: 800, height: 500 },
  deviceScaleFactor: 1,
  colorScheme: "dark",
});
const page = await context.newPage();

for (const prefix of prefixes) {
  await page.goto(`${base}/preview/${prefix}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(out, `${prefix}.png`) });
  console.log(join(out, `${prefix}.png`));
}

await browser.close();
