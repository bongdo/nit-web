import { chromium } from "playwright-core";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { findBrowser } from "./browser.mjs";

const MAX_BYTES = 2 * 1024 * 1024;

function fail(message) {
  console.error(`htmlcheck: ${message}`);
  process.exit(1);
}

const input = process.argv[2];
if (!input) fail("usage: bin/htmlcheck <file.html>");

const file = resolve(input);
const info = await stat(file).catch(() => null);
if (!info?.isFile()) fail(`${input} is not a file`);
if (info.size > MAX_BYTES) fail(`${input} is larger than 2 MiB`);

const source = await readFile(file, "utf8");
const start = source
  .replace(/^\uFEFF/, "")
  .replace(/^\s*<!--[\s\S]*?-->/g, "")
  .trimStart()
  .toLowerCase();
if (!start.startsWith("<!doctype html") && !start.startsWith("<html")) {
  fail(`${input} must start with <!doctype html> or <html>`);
}

const executablePath = await findBrowser();
if (!executablePath) fail("no chromium found; set NIT_PREVIEW_BROWSER");

const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
const errors = [];
try {
  const context = await browser.newContext({
    viewport: { width: 900, height: 700 },
    colorScheme: "dark",
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(pathToFileURL(file).href, { waitUntil: "domcontentloaded", timeout: 15_000 });
  await page.waitForTimeout(600);
  const report = await page.evaluate(() => ({
    height: Math.max(
      document.documentElement.scrollHeight,
      document.body?.scrollHeight ?? 0,
    ),
    width: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0),
    elements: document.body?.querySelectorAll("*").length ?? 0,
  }));
  if (errors.length > 0) fail(`${input} logged errors:\n${errors.join("\n")}`);
  if (report.elements === 0) fail(`${input} rendered an empty body`);
  if (report.width > 902) {
    console.error(`htmlcheck: warning: page is ${report.width}px wide and will scroll sideways`);
  }
  console.log(`htmlcheck: ok ${input} (${report.height}px tall)`);
} finally {
  await browser.close();
}
