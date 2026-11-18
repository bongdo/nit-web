import { chromium } from "playwright-core";
import { findBrowser } from "./browser.mjs";

const executablePath = await findBrowser();
const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
const fail = (message) => {
  console.error("FAIL:", message);
  process.exitCode = 1;
};
const highlighted = (page) =>
  page.evaluate(() => {
    const highlight = CSS.highlights.get("speech");
    return highlight ? Array.from(highlight, (range) => range.toString()) : [];
  });

try {
  const context = await browser.newContext({ viewport: { width: 900, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto("http://127.0.0.1:7788/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await page.getByText("/home/ubuntu/Projects/nit-gui", { exact: true }).first().click();
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: /^Аудит архитектуры/ }).first().click();

  await page.evaluate(() => {
    const element = document.querySelector("[data-transcript]");
    if (element) element.scrollTop = element.scrollHeight;
  });
  await page.waitForTimeout(1500);
  const read = page.getByRole("button", { name: "Read aloud" }).last();
  console.log("read buttons", await page.getByRole("button", { name: "Read aloud" }).count());
  await read.waitFor({ timeout: 30000 });
  const blocks = page.locator("[data-speech-block]");
  await blocks.first().waitFor({ timeout: 30000 });
  console.log("blocks", await blocks.count());

  await read.click();
  await page.locator("[data-speaking]").first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(1200);
  const sentence = await highlighted(page);
  console.log("sentence", JSON.stringify(sentence));
  if (!sentence.length) fail("no sentence highlight");

  const before = await page.locator("[data-speaking]").first().getAttribute("data-speech-block");
  await page.waitForTimeout(9000);
  const after = await page.locator("[data-speaking]").first().getAttribute("data-speech-block");
  const later = await highlighted(page);
  console.log("block", before, "->", after, "sentence", JSON.stringify(later));
  if (JSON.stringify(later) === JSON.stringify(sentence)) fail("highlight did not advance");

  await page.screenshot({ path: "/tmp/nit-speech2.png" });
  await page.getByRole("button", { name: "Stop reading" }).first().click();
  await page.waitForTimeout(500);
  console.log("highlight after stop", JSON.stringify(await highlighted(page)));

  await blocks.nth(5).selectText();
  await page.waitForTimeout(500);
  const readSelection = page.getByRole("button", { name: "Read selection aloud" });
  console.log("selection button", await readSelection.count());
  if (!(await readSelection.count())) fail("no read button in the selection popover");
  else {
    await readSelection.first().evaluate((element) => element.click());
    await page.getByRole("button", { name: "Pause reading" }).first().waitFor({ timeout: 15000 });
    console.log("selection reading ok");
    console.log("previous disabled", await page.getByRole("button", { name: "Previous paragraph" }).first().isDisabled());
    await page.getByRole("button", { name: "Stop reading" }).first().click();
  }

  console.log("errors", errors.slice(0, 5));
} catch (error) {
  fail(String(error));
} finally {
  await browser.close();
}
