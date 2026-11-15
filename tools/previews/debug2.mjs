import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: process.env.B, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 800, height: 500 }, colorScheme: "dark" });
const page = await ctx.newPage();
page.on("response", async (res) => {
  const url = res.url();
  if (url.includes("/term/")) console.log(res.status(), res.headers()["content-type"], url);
});
await page.goto("http://127.0.0.1:8090/preview/term", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
console.log("cookies:", (await ctx.cookies()).map((c) => `${c.name}=${c.value.slice(0, 12)}`));
await browser.close();
