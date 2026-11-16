import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { findBrowser } from "../previews/browser.mjs";

const require = createRequire(new URL("../previews/package.json", import.meta.url));
const { chromium } = require("playwright-core");

const MAX_BYTES = 2 * 1024 * 1024;
const SAFE_PATH = /^[A-Za-z0-9._/-]+$/;
const HTML_START =
  /^<(?:!doctype\s+html|html[\s>]|(?:a|article|audio|body|br|button|canvas|details|div|figure|footer|form|h[1-6]|head|header|hr|iframe|img|li|link|main|meta|nav|ol|p|pre|section|select|span|style|script|svg|table|textarea|ul|video)\b)/i;

function fail(message) {
  console.error(`page: ${message}`);
  process.exit(1);
}

function slug(value) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "page"
  );
}

function findRoot(start) {
  let dir = start;
  while (true) {
    if (existsSync(join(dir, ".git")) || existsSync(join(dir, ".jj"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

function titleOf(source) {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(source);
  return match ? match[1].replace(/<[^>]*>/g, " ").trim() : "";
}

function cleanTitle(value) {
  const text = value.replace(/[\[\]|\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  return text.slice(0, 120) || "Page";
}

const args = process.argv.slice(2);
let title = "";
const files = [];
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--title" || arg === "-t") {
    title = args[++index] ?? "";
    continue;
  }
  if (arg.startsWith("--title=")) {
    title = arg.slice("--title=".length);
    continue;
  }
  if (arg === "--help" || arg === "-h") {
    console.log('usage: page <file.html> [--title "Title"]');
    process.exit(0);
  }
  files.push(arg);
}
if (files.length !== 1) fail('usage: page <file.html> [--title "Title"]');

const input = files[0];
const cwd = process.cwd();
const absolute = resolve(cwd, input);
const info = await stat(absolute).catch(() => null);
if (!info?.isFile()) fail(`${input} is not a file`);
if (info.size > MAX_BYTES) fail(`${input} is larger than 2 MiB`);

const source = await readFile(absolute, "utf8");
if (/\bbackground(?:-color)?\s*:\s*(?:#fff(?:fff)?|white)\b/i.test(source)) {
  console.error(
    "page: warning: hardcoded white background; leave html/body transparent to follow the app theme",
  );
}
const start = source
  .replace(/^\uFEFF/, "")
  .replace(/^\s*<!--[\s\S]*?-->/g, "")
  .trimStart();
if (!HTML_START.test(start)) fail(`${input} does not look like HTML`);

const root = findRoot(cwd);
const inside = relative(root, absolute);
const safe =
  inside !== "" &&
  inside !== ".." &&
  !inside.startsWith(`..${sep}`) &&
  SAFE_PATH.test(inside.split(sep).join("/")) &&
  /\.html?$/i.test(inside);
let target = absolute;
let markerPath = inside.split(sep).join("/");
if (!safe) {
  const hash = createHash("sha256").update(source).digest("hex").slice(0, 8);
  const name = `${slug(basename(absolute, extname(absolute)))}-${hash}.html`;
  const dir = join(root, ".nit", "pages");
  await mkdir(dir, { recursive: true });
  target = join(dir, name);
  await writeFile(target, source);
  markerPath = relative(root, target).split(sep).join("/");
}

const executablePath = await findBrowser();
if (executablePath) {
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
    await page.goto(pathToFileURL(target).href, {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });
    await page.waitForTimeout(700);
    const report = await page.evaluate(() => ({
      elements: document.body?.querySelectorAll("*").length ?? 0,
      width: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0),
    }));
    if (errors.length > 0) fail(`${input} logged errors:\n${errors.join("\n")}`);
    if (report.elements === 0) fail(`${input} rendered an empty body`);
    if (report.width > 902) {
      console.error(`page: warning: ${report.width}px wide, the page will scroll sideways`);
    }
  } finally {
    await browser.close();
  }
} else {
  console.error("page: warning: no chromium found; skipped the runtime check");
}

console.log(`[[html:${markerPath}|${cleanTitle(title || titleOf(source) || basename(absolute, extname(absolute)))}]]`);
