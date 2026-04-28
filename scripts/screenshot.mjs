// Captures docs/preview.png from the deployed site. The player needs time
// to load the bundled composition and seek to a frame with the logo visible.

import { chromium } from "playwright";

const url = process.argv[2] ?? "https://hyperframes-on-cloudflare.jdrusso1020.workers.dev/";
const out = process.argv[3] ?? "docs/preview.png";
const seekTime = Number(process.argv[4] ?? 4);

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({
  viewport: { width: 1200, height: 628 },
  deviceScaleFactor: 2,
});

await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });

await page.waitForFunction(
  () => {
    const player = document.querySelector("hyperframes-player");
    return player && player.ready === true;
  },
  null,
  { timeout: 15000 },
);

await page.evaluate((t) => {
  const player = document.querySelector("hyperframes-player");
  player.currentTime = t;
}, seekTime);

await page.waitForTimeout(1500);

await page.screenshot({ path: out, fullPage: false });
console.log(`wrote ${out}`);
await browser.close();
