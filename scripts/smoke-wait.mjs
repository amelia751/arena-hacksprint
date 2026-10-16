#!/usr/bin/env node
/**
 * A person takes longer than a server is allowed to hold a request. The whole
 * game hangs on wait_for_turn staying in the call anyway: an assistant only
 * plays while it is answering, so the moment it gives up and replies, nothing
 * on the page can reach it again until the person types.
 *
 *   node scripts/smoke-wait.mjs <base> [seconds the person takes]
 */
import { chromium } from "playwright";
import { CONNECT_FOUR, forget, seed } from "./fixtures.mjs";

const BASE = process.argv[2] || process.env.ARENA_BASE || "http://localhost:3000";
const SLOW = Number(process.argv[3] || 40) * 1000;

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

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const dealt = String(await call("start_match", { environment_id: env }));
check("a match is dealt", /"match_id"/.test(dealt), dealt.slice(0, 60));

// The agent settles in to wait. Meanwhile the person stares at the board for a
// good while — far longer than any single request is allowed to live.
console.log(`\nthe agent starts waiting; the person will move in ${SLOW / 1000}s\n`);
const startedAt = Date.now();
const waiting = call("wait_for_turn", {});

setTimeout(() => {
  void page
    .frameLocator("iframe[title='Game table']")
    .locator("[data-action='col_3']:not([disabled])")
    .first()
    .click({ timeout: 8000 })
    .then(() => console.log(`   (the person moved at ${Math.round((Date.now() - startedAt) / 1000)}s)`))
    .catch((e) => console.log("   the person could not move:", e.message.split("\n")[0]));
}, SLOW);

const out = String(await waiting);
const took = Date.now() - startedAt;
console.log(`   wait_for_turn answered after ${Math.round(took / 1000)}s\n`);

check("the wait outlived the old eight second ceiling", took > 12000, `${Math.round(took / 1000)}s`);
check("it held until the person actually moved", took >= SLOW - 2000, `${Math.round(took / 1000)}s vs ${SLOW / 1000}s`);
check("it came back ready, not still_waiting", !/still_waiting/.test(out), out.slice(0, 70));
check("it returned the agent's turn", /"your_turn":true/.test(out), out.slice(0, 90));

const rev = /"revision":(\d+)/.exec(out)?.[1];
const played = String(await call("take_action", {
  action: "col_5",
  expected_revision: Number(rev),
  rationale: "Testing that the agent can move straight after a long wait.",
  confidence: 3,
}));
check("and the agent can move straight away", /"ok":true/.test(played), played.slice(0, 60));

await browser.close();
await forget([env]);
console.log(bad ? `\n${bad} failed` : "\nthe agent waits as long as a person needs");
process.exit(bad ? 1 : 0);
