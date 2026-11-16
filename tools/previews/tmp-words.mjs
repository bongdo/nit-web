import { chromium } from "playwright-core";
import { findBrowser } from "./browser.mjs";
const session = "ses_e1996ed85ffeV89eA0yyVBDJ0m";
const browser = await chromium.launch({ executablePath: await findBrowser(), args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
await context.addInitScript(({ session }) => {
  localStorage.setItem("nit-gui.session", session);
  localStorage.setItem("nit-gui.workspace", "/home/ubuntu/Projects/nit-gui");
}, { session });
const page = await context.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
await page.goto("http://127.0.0.1:7782/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await page.evaluate(() => { const el = document.querySelector("[data-transcript]"); if (el) el.scrollTop = el.scrollHeight; });
const prompt = "Ответь примерно на 250 слов связным текстом о плавном показе потокового текста. Используй два абзаца, список из 4 пунктов, inline `code`, одну **жирную** фразу и блок кода на 3 строки. Без HTML.";
await fetch("http://127.0.0.1:7782/api/sessions/" + session + "/prompt", { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify({ text: prompt }) });
let shots = 0;
const start = Date.now();
const samples = [];
while (Date.now() - start < 25000) {
  const s = await page.evaluate(() => {
    const transcript = document.querySelector("[data-transcript]");
    const words = [...document.querySelectorAll(".word")];
    const first = words[0];
    const firstAnim = first?.getAnimations?.()[0];
    return {
      words: words.length,
      inPre: document.querySelectorAll("pre .word").length,
      inCode: document.querySelectorAll("code .word").length,
      running: words.filter(w => w.getAnimations?.().some(a => a.playState === "running")).length,
      firstState: firstAnim?.playState ?? null,
      firstCurrent: firstAnim ? Math.round(firstAnim.currentTime ?? 0) : null,
      gap: transcript ? transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight : 0,
      text: transcript?.innerText.length ?? 0,
    };
  });
  s.t = Date.now() - start;
  samples.push(s);
  if (s.t > 2500 && s.t < 4500 && shots === 0) { await page.screenshot({ path: "/tmp/opencode/word-birth-1.png" }); shots++; }
  if (s.t > 6500 && s.t < 9000 && shots === 1) { await page.screenshot({ path: "/tmp/opencode/word-birth-2.png" }); shots++; }
  if (s.words > 20 && s.running === 0 && s.gap < 2 && samples.length > 20) break;
  await page.waitForTimeout(250);
}
await page.screenshot({ path: "/tmp/opencode/word-birth-end.png" });
console.log(JSON.stringify({
  samples: samples.length,
  maxWords: Math.max(...samples.map(s => s.words)),
  maxRunning: Math.max(...samples.map(s => s.running)),
  inPre: Math.max(...samples.map(s => s.inPre)),
  inCode: Math.max(...samples.map(s => s.inCode)),
  firstStates: samples.map(s => s.firstState).filter(Boolean).slice(0, 20),
  firstCurrents: samples.map(s => s.firstCurrent).filter(v => v !== null).slice(0, 20),
  maxGap: Math.max(...samples.map(s => s.gap)),
  p95Gap: samples.map(s => s.gap).sort((a,b)=>a-b)[Math.floor(samples.length*0.95)],
  last: samples[samples.length-1],
  errors,
}, null, 2));
await browser.close();
