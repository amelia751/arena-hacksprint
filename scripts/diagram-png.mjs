/**
 * Export the appendix diagram as the README image.
 *
 * The figure is a live page, so it can be drawn at whatever density we ask for
 * rather than upscaled from a screenshot. Three device pixels per CSS pixel is
 * what keeps the small type in the tool column legible on a retina display.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const BASE = process.env.ARENA_BASE || "http://localhost:3000";
const SCALE = Number(process.env.SCALE || 3);
const OUT = path.join(process.cwd(), "docs", "architecture.png");

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1180, height: 760 },
  deviceScaleFactor: SCALE,
});

await page.goto(`${BASE}/diagram`, { waitUntil: "networkidle" });
// The grid itself, not the figure — the caption below it belongs to the page,
// not to the picture.
await page.waitForSelector("figure.diagram .dg");
// Web fonts land after paint, and half-loaded type is the one thing a still
// image cannot recover from.
await page.evaluate(() => document.fonts.ready);
// The dev-mode indicator is fixed to the corner, so an element shot taken over
// that corner picks it up.
await page.addStyleTag({ content: "nextjs-portal, #__next-dev-overlay { display: none !important }" });
await page.waitForTimeout(400);

mkdirSync(path.dirname(OUT), { recursive: true });
const figure = page.locator("figure.diagram .dg");
const box = await figure.boundingBox();
await figure.screenshot({ path: OUT, scale: "device" });

await browser.close();
console.log(`wrote ${OUT} — ${Math.round(box.width * SCALE)}x${Math.round(box.height * SCALE)}`);
