import { chromium } from "playwright-core";
import { findBrowser } from "./browser.mjs";
const session = process.env.SID;
const mode = process.env.MODE || "base";
const sections = 20;
const text = Array.from({ length: sections }, (_, i) => {
  const body = Array.from({ length: 90 }, (_, j) => `word${(i * 90 + j) % 17}`).join(" ");
  const list = i % 3 === 0 ? "\n\n" + Array.from({ length: 6 }, (_, j) => `- item ${i}-${j}`).join("\n") : "";
  return `## Section ${i}\n\n${body}${list}`;
}).join("\n\n") + "\n\n```js\n" + Array.from({ length: 8 }, (_, i) => `const x${i} = ${i};`).join("\n") + "\n```";
const browser = await chromium.launch({ executablePath: await findBrowser(), args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
await context.addInitScript(({ session, mode }) => {
  localStorage.setItem("nit-gui.session", session);
  localStorage.setItem("nit-gui.workspace", "/home/ubuntu/Projects/nit-gui");
  class FakeSource {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    constructor(url) { this.url = url; this.readyState = 0; window.__sources.push(this); setTimeout(() => { this.readyState = 1; this.onopen?.({}); }, 0); }
    close() { this.readyState = 2; }
  }
  window.__sources = []; window.EventSource = FakeSource;
  window.__emit = (event) => { const payload = { data: JSON.stringify(event) }; for (const source of window.__sources) source.onmessage?.(payload); };
  window.__frames = []; window.__long = []; window.__measuring = false;
  let last = performance.now();
  const tick = (now) => { if (window.__measuring) window.__frames.push([now, now - last]); last = now; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  try { new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__long.push([entry.startTime, entry.duration]); }).observe({ entryTypes: ["longtask"] }); } catch {}
  document.addEventListener("DOMContentLoaded", () => {
    const style = document.createElement("style");
    style.textContent = [
      mode === "nomask" ? ".stream-soft{-webkit-mask-image:none!important;mask-image:none!important}" : "",
      mode === "noscene" ? "canvas{display:none!important}" : "",
    ].join("\n");
    document.head.appendChild(style);
  });
  window.__start = (session, text) => {
    const id = "msg_bench";
    const base = { sessionID: session, assistantMessageID: id, ordinal: 0 };
    window.__streamStart = performance.now();
    window.__measuring = true;
    window.__emit({ type: "session.execution.started", data: { sessionID: session } });
    window.__emit({ type: "session.step.started", data: { ...base, agent: "build", model: { id: "bench", providerID: "bench" }, started: Date.now() } });
    window.__emit({ type: "session.text.started", data: { ...base, text: "" } });
    let at = 0, index = 0;
    const sizes = [7, 13, 4, 19, 8, 11, 3, 16, 6, 10, 5, 14];
    const timer = setInterval(() => {
      const end = Math.min(text.length, at + sizes[index++ % sizes.length]);
      window.__emit({ type: "session.text.delta", data: { ...base, delta: text.slice(at, end) } });
      at = end;
      if (at >= text.length) {
        clearInterval(timer);
        window.__emit({ type: "session.text.ended", data: { ...base, text } });
        setTimeout(() => { window.__measuring = false; window.__done = true; }, 1200);
      }
    }, 16);
  };
}, { session, mode });
const page = await context.newPage();
await page.goto("http://127.0.0.1:7783/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await page.evaluate(({ session, text }) => { const el = document.querySelector("[data-transcript]"); if (el) el.scrollTop = el.scrollHeight; window.__start(session, text); }, { session, text });
const start = Date.now();
while (Date.now() - start < 50000) { if (await page.evaluate(() => Boolean(window.__done))) break; await page.waitForTimeout(200); }
const report = await page.evaluate(() => {
  const start = window.__streamStart;
  const frames = window.__frames.filter(([t]) => t >= start).map(([t, gap]) => ({ t, gap }));
  const gaps = frames.map(({t,gap}) => ({ t: Math.round(t - start), gap: Math.round(gap) })).filter((x) => x.gap > 80);
  const long = window.__long.filter(([t]) => t >= start).map(([t, d]) => ({ t: Math.round(t - start), d: Math.round(d) }));
  const sorted = frames.map(({gap}) => gap).sort((a, b) => a - b);
  return { total: Math.round(performance.now() - start), frames: frames.length, p95: sorted[Math.floor(sorted.length*0.95)], max: sorted[sorted.length-1], gapCount: gaps.length, gaps: gaps.slice(0, 8), longCount: long.length, longMax: long.length ? Math.max(...long.map((x)=>x.d)) : 0, long: long.slice(0, 6) };
});
console.log(JSON.stringify({ mode, report }, null, 2));
await browser.close();
