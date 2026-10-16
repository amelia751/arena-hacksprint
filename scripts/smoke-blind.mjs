#!/usr/bin/env node
/**
 * Plays a game the way a person does: by looking.
 *
 * Every other test here asks the API which moves are legal and then clicks that
 * selector, which means a board that paints its controls invisible, dead, or
 * off-screen still passes. This one never reads legal_actions. It finds what is
 * visibly clickable in the rendered frame, clicks it by coordinate, and insists
 * the move lands. If a person could not play the game, this fails.
 *
 *   node scripts/smoke-blind.mjs <base> [environment_id]
 */
import { chromium } from "playwright";
import { CONNECT_FOUR, forget, seed } from "./fixtures.mjs";

const BASE = process.argv[2] || process.env.ARENA_BASE || "http://localhost:3000";
let ENV = process.argv[3];
const mine = [];

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

if (!ENV) {
  ENV = await seed(BASE, CONNECT_FOUR);
  mine.push(ENV);
  const v = await post(`/api/environments/${ENV}/validate`);
  await post(`/api/environments/${ENV}/publish`, {
    expected_revision: v.revision,
    confirm_info_flow: true,
  });
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("response", (r) => {
  if (r.status() >= 400 && r.url().includes("/api/")) problems.push(`${r.status()} ${r.url()}`);
});

await page.goto(`${BASE}/e/${ENV}`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

// Deal from outside the page, the way the agent's tool does.
const dealt = await post("/api/matches", { environment_id: ENV, seat: 0, agent_label: "blind" });
check("a match appears without touching the page", !!dealt.match?.id, dealt.match?.id);
await page.waitForTimeout(5000);

const frame = page.frameLocator("iframe[title='Game table']");

/** What a person could actually aim at: painted, big enough, and not greyed out. */
async function visibleControls() {
  const handle = await page.$("iframe[title='Game table']");
  if (!handle) return [];
  const box = await handle.boundingBox();
  if (!box) return [];
  const found = await frame.locator("[data-action]").evaluateAll((nodes) =>
    nodes.map((n) => {
      const r = n.getBoundingClientRect();
      const s = getComputedStyle(n);
      return {
        action: n.getAttribute("data-action"),
        x: r.x + r.width / 2,
        y: r.y + r.height / 2,
        w: r.width,
        h: r.height,
        dead:
          n.hasAttribute("disabled") ||
          n.getAttribute("aria-disabled") === "true" ||
          s.pointerEvents === "none" ||
          s.visibility === "hidden" ||
          s.display === "none" ||
          Number(s.opacity) < 0.25,
        label: (n.innerText || n.getAttribute("aria-label") || "").trim(),
      };
    }),
  );
  return found
    .filter((c) => !c.dead && c.w >= 16 && c.h >= 16)
    .map((c) => ({ ...c, px: box.x + c.x, py: box.y + c.y }));
}

/**
 * A board is swapped out whole each time it repaints, so an instant exists when
 * there is nothing on screen. Nobody clicks in that instant — they look again.
 */
async function waitForControls(ms = 4000) {
  const until = Date.now() + ms;
  for (;;) {
    const found = await visibleControls();
    if (found.length || Date.now() > until) return found;
    await page.waitForTimeout(200);
  }
}

const first = await visibleControls();
check("something is visibly clickable once the match is dealt", first.length > 0, `${first.length} controls`);
check(
  "every control a person can aim at is big enough to hit",
  first.every((c) => c.h >= 32),
  first.map((c) => `${c.action}:${Math.round(c.w)}x${Math.round(c.h)}`).join(" ").slice(0, 160),
);
check(
  "controls are not all blank",
  first.some((c) => c.label.length > 0),
  first.map((c) => c.label || "(blank)").join(",").slice(0, 120),
);

const rows = () => page.locator(".tape tbody tr").count();
let played = 0;
let stuckAt = null;

for (let turn = 0; turn < 30; turn++) {
  const state = await (await fetch(`${BASE}/api/matches/${dealt.match.id}`)).json();
  if (state.match?.terminal) break;
  if (state.match?.to_move !== 0) {
    await page.waitForTimeout(900);
    continue;
  }
  const controls = await waitForControls();
  if (!controls.length) {
    stuckAt = `turn ${turn}: it is my move and nothing is clickable`;
    break;
  }
  const pick = controls[Math.floor(Math.random() * controls.length)];
  const before = await rows();
  // Click where the pixel is, not what the selector says — that is all a person has.
  await page.mouse.click(pick.px, pick.py);
  let landed = false;
  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(250);
    if ((await rows()) > before) {
      landed = true;
      break;
    }
  }
  if (!landed) {
    stuckAt = `turn ${turn}: clicked ${pick.action} at ${Math.round(pick.px)},${Math.round(pick.py)} and nothing happened`;
    break;
  }
  played++;
  await page.waitForTimeout(700);
}

check("a person can keep playing by clicking what they see", stuckAt == null, stuckAt);
check("the game actually progressed", played >= 3, `${played} moves clicked by eye`);

const final = await (await fetch(`${BASE}/api/matches/${dealt.match.id}`)).json();
check("the game reached an end", final.match?.terminal === true, `terminal=${final.match?.terminal}`);
const status = (await page.locator(".desk-status").innerText()).replace(/\s+/g, " ").trim();
check("the page says how it ended", /WON|DRAW/i.test(status), status);

const board = await frame.locator("body").innerText();
check(
  "the finished board is not still announcing a turn",
  !/turn/i.test(board) || /win|won|draw|over/i.test(board),
  board.replace(/\s+/g, " ").slice(0, 100),
);

check("nothing failed underneath", problems.length === 0, problems.slice(0, 3).join(" | "));

await page.screenshot({ path: ".data/smoke/blind.png", fullPage: true });
await browser.close();
if (mine.length) await forget(mine);
console.log(bad ? `\n${bad} failed` : "\na person could play this by looking at it");
process.exit(bad ? 1 : 0);
