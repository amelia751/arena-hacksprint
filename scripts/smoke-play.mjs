#!/usr/bin/env node
/** Human clicks the live table, agent answers through the tools. Checks the whole path. */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { CONNECT_FOUR, forget, seed } from "./fixtures.mjs";

const BASE = process.argv[2] || process.env.ARENA_BASE || "http://localhost:3000";
const OUT = path.join(process.cwd(), ".data", "smoke");
mkdirSync(OUT, { recursive: true });

const ENV = process.argv[3] || (await seed(BASE, CONNECT_FOUR));
const seeded = process.argv[3] ? [] : [ENV];

const browser = await chromium.launch({
  headless: true,
  args: ["--enable-experimental-web-platform-features", "--enable-features=WebMCPTesting"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
page.on("console", (m) => m.type() === "error" && console.log("CONSOLE ERROR:", m.text()));
await page.goto(BASE, { waitUntil: "networkidle" });

const call = (name, args) =>
  page.evaluate(
    async ([n, a]) => {
      const ctx = document.modelContext;
      const tool = (await ctx.getTools()).find((t) => t.name === n);
      if (!tool) return `no tool ${n}`;
      try {
        return await ctx.executeTool(tool, JSON.stringify(a || {}));
      } catch (e) {
        return "error: " + e.message;
      }
    },
    [name, args],
  );

/** Tool answers are prose that may open with a JSON object. */
const leadingJson = (text) => JSON.parse(String(text).split("\n")[0]);

const clickSoon = (delay = 1500) =>
  new Promise((resolve) =>
    setTimeout(() => {
      page
        .frameLocator("iframe[title='Game table']")
        .locator("[data-action]:not([disabled])")
        .first()
        .click({ timeout: 8000 })
        .then(() => resolve(true))
        .catch(() => resolve(false));
    }, delay),
  );

console.log("--- start_match ---");
const opening = clickSoon(2000);
const started = leadingJson(await call("start_match", { environment_id: ENV, agent_label: "smoke-agent" }));
await opening;
console.log(started);
const matchId = started.match_id;
const agentSeat = started.your_seat;

const state = async () => (await fetch(`${BASE}/api/matches/${matchId}`)).json();

for (let round = 1; round <= 6; round++) {
  let s = await state();
  if (s.match.terminal) break;
  if (s.match.to_move !== agentSeat) break;

  const view = leadingJson(
    String(await call("get_observation", {})).split("\n").find((l) => l.startsWith("{")) || "{}",
  );
  const choice = view.legal_actions?.[0];
  if (!choice) break;
  console.log(`[agent] take_action ${choice} at revision ${view.revision}`);
  const human = clickSoon(2000);
  const res = await call("take_action", {
    action: choice,
    expected_revision: view.revision,
    rationale: "smoke test",
    confidence: 3,
  });
  await human;
  console.log(`[agent] ${String(res).slice(0, 220)}`);
}

await page.waitForTimeout(600);
await page.screenshot({ path: path.join(OUT, "play-final.png"), fullPage: true });

console.log("\n--- inspect_view ---");
console.log(await call("inspect_view", {}));

console.log("\n--- export_episodes ---");
console.log(await call("export_episodes", {}));

const jsonl = await (await fetch(`${BASE}/api/episodes?match_id=${matchId}&format=jsonl`)).text();
const lines = jsonl.split("\n").filter(Boolean);
console.log(`\n${lines.length} rows in the downloadable JSONL`);
for (const l of lines) {
  const row = JSON.parse(l);
  if (row.type === "episode") console.log(`episode ${row.match_id} seats=${JSON.stringify(row.seats.map((s) => s.interface))} returns=${JSON.stringify(row.returns)}`);
  else console.log(`  step ${row.index} seat=${row.seat} by=${row.interface} action=${row.action} r=${row.reward} conf=${row.confidence}`);
}

await browser.close();
await forget(seeded);
