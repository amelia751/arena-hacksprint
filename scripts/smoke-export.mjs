#!/usr/bin/env node
/**
 * The agent's own view of the dataset. export_episodes hands back a shape and a
 * link rather than the bytes, so the link has to be absolute, live, and made of
 * lines that parse — otherwise the agent is describing a file nobody can fetch.
 *
 *   node scripts/smoke-export.mjs <base> <environment_id>
 */
import { chromium } from "playwright";

const BASE = process.argv[2] || process.env.ARENA_BASE || "http://localhost:3000";
const ENV = process.argv[3];
if (!ENV) {
  console.error("usage: node scripts/smoke-export.mjs <base> <environment_id>");
  process.exit(2);
}

let bad = 0;
const check = (what, ok, detail) => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail != null ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({
  headless: true,
  args: ["--enable-experimental-web-platform-features", "--enable-features=WebMCPTesting"],
});
const page = await browser.newPage();
const call = (name, args) =>
  page.evaluate(
    async ([n, a]) => {
      const ctx = document.modelContext;
      const t = (await ctx.getTools()).find((x) => x.name === n);
      if (!t) return `no tool ${n}`;
      try {
        return await ctx.executeTool(t, JSON.stringify(a || {}));
      } catch (e) {
        return "error: " + e.message;
      }
    },
    [name, args],
  );

await page.goto(`${BASE}/e/${ENV}`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);

// Once with no arguments, which has to find the match on screen, and once scoped
// to the game, which has to gather every match played on it.
for (const args of [{}, { environment_id: ENV }]) {
  const tag = Object.keys(args).length ? "scoped to the game" : "defaulting to the table";
  const out = String(await call("export_episodes", args));
  let body = null;
  try {
    body = JSON.parse(out);
  } catch {
    /* reported below */
  }
  check(`${tag}: the answer is json`, body != null, out.slice(0, 120));
  if (!body) continue;

  check(`${tag}: it counts what it found`, body.episodes > 0 && body.steps > 0, `${body.episodes} episodes, ${body.steps} steps`);
  check(`${tag}: it shows an episode header`, Array.isArray(body.headers) && body.headers[0]?.type === "episode");
  check(`${tag}: it shows a whole sample row`, body.sample_step?.type === "step" && "observation" in body.sample_step);
  check(`${tag}: the link is absolute`, /^https?:\/\//.test(body.download || ""), body.download);

  const res = await fetch(body.download);
  const text = await res.text();
  const lines = text.trim().split("\n").filter(Boolean);
  let parses = true;
  try {
    lines.forEach((l) => JSON.parse(l));
  } catch (e) {
    parses = false;
    console.log("   parse error:", e.message);
  }
  check(`${tag}: the link serves the file`, res.status === 200, `${res.status} ${res.headers.get("content-type")}`);
  check(`${tag}: every line parses`, parses, `${lines.length} lines`);
  check(
    `${tag}: the file holds what the answer promised`,
    lines.length === body.episodes + body.steps,
    `${lines.length} vs ${body.episodes + body.steps}`,
  );
}

await browser.close();
console.log(bad ? `\n${bad} failed` : "\nthe agent hands back a file that exists");
process.exit(bad ? 1 : 0);
