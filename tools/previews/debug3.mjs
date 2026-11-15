import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: process.env.B, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 800, height: 500 }, colorScheme: "dark" });
const page = await ctx.newPage();
page.on("request", (req) => {
  if (req.url().includes("/term/assets/")) console.log("REQ", req.url(), JSON.stringify(req.headers()));
});
page.on("response", async (res) => {
  if (res.url().includes("/term/assets/") && res.status() !== 200) {
    console.log("RES", res.status(), JSON.stringify(res.headers()));
    console.log("BODY", (await res.text()).slice(0, 200));
  }
});
await page.goto("http://127.0.0.1:8090/preview/term", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
await browser.close();
