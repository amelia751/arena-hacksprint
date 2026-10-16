#!/usr/bin/env node
/**
 * A match is one thing whoever deals it. These are the ways a person used to
 * end up staring at a Start button while the agent waited for a move: the agent
 * deals from somewhere else, the page reloads mid-game, or the person never
 * left the front page. The agent's own tools have to survive the same moves.
 */
import { chromium } from "playwright";
import { CONNECT_FOUR, forget, seed } from "./fixtures.mjs";

const BASE = process.argv[2] || process.env.ARENA_BASE || "http://localhost:3000";
const post = (u, b) =>
  fetch(BASE + u, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(b ?? {}),
  }).then((r) => r.json());

async function publish(fixture) {
  const id = await seed(BASE, fixture);
  const v = await post(`/api/environments/${id}/validate`);
  await post(`/api/environments/${id}/publish`, {
    expected_revision: v.revision,
    confirm_info_flow: true,
  });
  return id;
}

let failures = 0;
const check = (what, ok, detail) => {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? ` — ${detail}` : ""}`);
};

const table = await publish(CONNECT_FOUR);
const front = await publish(CONNECT_FOUR);

const browser = await chromium.launch({
  headless: true,
  args: ["--enable-experimental-web-platform-features", "--enable-features=WebMCPTesting"],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

const call = (name, args) =>
  page.evaluate(
    async ([n, a]) => {
      const ctx = document.modelContext;
      const tools = await ctx.getTools();
      const t = tools.find((x) => x.name === n);
      if (!t) return `no tool ${n}`;
      try {
        return await ctx.executeTool(t, JSON.stringify(a || {}));
      } catch (e) {
        return "error: " + e.message;
      }
    },
    [name, args],
  );

const status = async () => (await page.locator(".desk-status").innerText()).replace(/\n/g, " ");
const drop = async (action) =>
  page
    .frameLocator("iframe[title='Game table']")
    .locator(`[data-action="${action}"]:not([disabled])`)
    .first()
    .click({ timeout: 5000 });

// 1. The person is at the table; the match is dealt from anywhere else.
await page.goto(`${BASE}/e/${table}`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await post("/api/matches", { environment_id: table, seat: 0, agent_label: "elsewhere" });
await page.waitForTimeout(5000);
check("a table joins a match dealt elsewhere", /YOUR TURN/i.test(await status()), await status());
let moved = true;
await drop("col_3").catch((e) => {
  moved = false;
  console.log("   click failed:", e.message.split("\n")[0]);
});
check("and the person can play it", moved);
await page.waitForTimeout(1500);

// 2. The page reloads mid-game. The board comes back, not a Start button.
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(4000);
const tape = (await page.locator(".tape").count())
  ? await page.locator(".tape").innerText()
  : "";
check("a reload rejoins the match in play", /TRAJECTORY · [1-9]/.test(tape), tape.slice(0, 60));

// 3. The person never left the front page.
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await post("/api/matches", { environment_id: front, seat: 0, agent_label: "elsewhere" });
await page.waitForTimeout(5000);
check("the front page points at a dealt match", (await page.locator(".dealt").count()) > 0);

// 4. The agent's play tools after the browser moves the page under them.
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const waiting = call("start_match", { environment_id: front });
await page.waitForTimeout(1500);
await drop("col_3").catch(() => {});
const dealt = await waiting;
check("start_match puts the table on screen", /\/e\//.test(page.url()), page.url());
check("start_match answers with a match", /"match_id"/.test(dealt), String(dealt).slice(0, 80));
await page.waitForTimeout(800);
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
const seen = await call("get_observation", {});
check("get_observation survives the page moving", /"match_id"/.test(seen), String(seen).slice(0, 80));
const rev = /"revision":(\d+)/.exec(String(seen))?.[1];
const played = await call("take_action", { action: "col_5", expected_revision: Number(rev) });
check("take_action survives it too", /"ok":true/.test(played), String(played).slice(0, 80));

await browser.close();
await forget([table, front]);
console.log(failures ? `\n${failures} failed` : "\na match is one thing whoever deals it");
process.exit(failures ? 1 : 0);
