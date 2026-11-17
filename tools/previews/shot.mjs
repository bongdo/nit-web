import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { findBrowser } from "./browser.mjs";

const base = process.env.NIT_GATE_URL || "http://127.0.0.1:8090";
const out = process.env.NIT_GATE_PREVIEWS || join(homedir(), ".local/state/nit-gui/gate/previews");
const prefixes = (process.env.NIT_PREVIEWS || "nit,pero,term,share").split(",").filter(Boolean);

const executablePath = await findBrowser();
if (!executablePath) {
  console.error("previews: no chromium found; set NIT_PREVIEW_BROWSER");
  process.exit(1);
}

await mkdir(out, { recursive: true });

const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
try {
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
} finally {
  await browser.close();
}
