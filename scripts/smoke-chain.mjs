#!/usr/bin/env node
/**
 * An assistant only runs while it is replying. If a play tool answers "your
 * move" the game stops there, because nothing on the page can reach a chat that
 * has finished talking — which is exactly what a real session did: start_match,
 * a friendly sentence, silence.
 *
 * So the test is not "can the tools play a game" but "does one call per turn
 * carry the game forward on its own". Each tool is called exactly once and then
 * the harness behaves like a person: it looks at the board and clicks.
 *
 *   node scripts/smoke-chain.mjs <base>
 */
import { chromium } from "playwright";
import { CONNECT_FOUR, forget, seed } from "./fixtures.mjs";

const BASE = process.argv[2] || process.env.ARENA_BASE || "http://localhost:3000";

let bad = 0;
const check = (what, ok, detail) => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail != null ? ` — ${detail}` : ""}`);
};
const post = (u, b) =>
  fetch(BASE + u, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(b ?? {}),
  }).then((r) => r.json());

const env = await seed(BASE, CONNECT_FOUR);
const v = await post(`/api/environments/${env}/validate`);
await post(`/api/environments/${env}/publish`, {
  expected_revision: v.revision,
  confirm_info_flow: true,
});

const browser = await chromium.launch({
  headless: true,
  args: ["--enable-experimental-web-platform-features", "--enable-features=WebMCPTesting"],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
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

/** The person: looks at the board, clicks something they can see, after a pause. */
const personMoves = (delay) =>
  new Promise((resolve) =>
    setTimeout(() => {
      page
        .frameLocator("iframe[title='Game table']")
        .locator("[data-action]:not([disabled])")
        .first()
        .click({ timeout: 10000 })
        .then(() => resolve(true))
        .catch(() => resolve(false));
    }, delay),
  );

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(800);

// The person sits down first, the way they did in the session that stalled.
await page.goto(`${BASE}/e/${env}`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /start match/i }).click();
await page.waitForTimeout(1500);
const live = () =>
  fetch(`${BASE}/api/matches?environment_id=${env}`)
    .then((r) => r.json())
    .then((r) => r.match?.id);
const before = await live();
check("the person's own match is on the table", !!before, before);

// The agent arrives. One call, and it must come back with the board its to play.
const person = personMoves(3000);
const dealt = String(await call("start_match", { environment_id: env, agent_label: "chain" }));
await person;

const after = await live();
check("it sat down instead of dealing a second match", !!before && after === before, `${before} -> ${after}`);
check("and it is playing the board the person clicked", dealt.includes(String(before)), dealt.slice(0, 60));
check("start_match came back with the agent to play", /"your_turn":true/.test(dealt), dealt.replace(/\s+/g, " ").slice(0, 110));
check("it did not hand back a 'their move'", !/It is their move/.test(dealt));

const revOf = (s) => Number(/"revision":(\d+)/.exec(s)?.[1]);
let text = dealt;
let calls = 0;

// From here the game should need one call per turn of the agent's, with nothing
// in between — no wait_for_turn, no second look, no message to the person.
while (calls < 8 && !/"terminal":true/.test(text)) {
  const action = /"legal_actions":\["([^"]+)"/.exec(text)?.[1];
  if (!action) break;
  const moving = personMoves(2500);
  text = String(
    await call("take_action", {
      action,
      expected_revision: revOf(text),
      rationale: "Playing the first action offered, to prove the call carries the game.",
      confidence: 3,
    }),
  );
  await moving;
  calls++;
  const ok = /"your_turn":true/.test(text) || /"terminal":true/.test(text);
  console.log(`   turn ${calls}: ${ok ? "came back ready to move again" : "stalled"}`);
  if (!ok) break;
}

check("every turn came back playable from one call", calls >= 4, `${calls} turns`);
check("the last answer is the agent's to act on", /"your_turn":true|"terminal":true/.test(text), text.replace(/\s+/g, " ").slice(0, 110));

await browser.close();
await forget([env]);
console.log(bad ? `\n${bad} failed` : "\none call per turn carries the game");
process.exit(bad ? 1 : 0);
