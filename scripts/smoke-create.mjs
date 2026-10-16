#!/usr/bin/env node
/**
 * Saving a draft has to come back quickly, and saying it twice has to mean once.
 *
 * A game with an expensive step() once spent twenty seconds being checked before
 * the save returned. That is long enough for the assistant to conclude the call
 * failed, send it again, and leave two copies of the same game on the page.
 *
 *   node scripts/smoke-create.mjs [base]
 */
import { CONNECT_FOUR } from "./fixtures.mjs";

const BASE = process.argv[2] || process.env.ARENA_BASE || "http://localhost:3000";

let bad = 0;
const check = (what, ok, detail) => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail != null ? ` — ${detail}` : ""}`);
};

const post = async (path, body) => {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

// The same game, but every move does a pile of pointless arithmetic first. It is
// still correct, just slow — exactly the shape that blew the time budget.
const SLOW = {
  name: `Slow Game ${Date.now()}`,
  description: "a correct game with an expensive step",
  players: 2,
  code: {
    ...CONNECT_FOUR.code,
    step: CONNECT_FOUR.code.step.replace(
      "function step(state, action) {",
      `function step(state, action) {
  var burn = 0;
  for (var q = 0; q < 300000; q++) burn += q % 7;
  if (burn < 0) throw new Error("unreachable");`,
    ),
  },
};

const t0 = Date.now();
const slow = await post("/api/environments", SLOW);
const took = Date.now() - t0;
check("an expensive game still saves", slow.status === 200 && Boolean(slow.body.environment?.id));
check("and it does not take all day", took < 8000, `${(took / 1000).toFixed(1)}s`);

const report = slow.body.environment?.validation;
check("it was still checked", (report?.checks?.length ?? 0) >= 9, `${report?.checks?.length} checks`);

// Being quick about a draft must not make publishing shallow: that is the one
// that freezes the code, and it is allowed to take its time.
const publishable = await post("/api/environments", {
  ...CONNECT_FOUR,
  name: `Publish Check ${Date.now()}`,
});
const pid = publishable.body.environment?.id;
const published = await post(`/api/environments/${pid}/publish`, {
  expected_revision: 1,
  confirm_info_flow: true,
});
const playouts = published.body.environment?.validation?.playouts ?? published.body.validation?.playouts;
check("publishing still runs the full sweep", (playouts?.n ?? 0) >= 1000, `${playouts?.n} playouts`);

// Sending the identical draft again is a repeat, not a second game.
const twin = {
  name: `Twin ${Date.now()}`,
  description: "sent twice",
  players: 2,
  code: CONNECT_FOUR.code,
};
const first = await post("/api/environments", twin);
const second = await post("/api/environments", twin);
const firstId = first.body.environment?.id;
const secondId = second.body.environment?.id;
check("saying it twice gives back the same game", firstId && firstId === secondId, `${firstId} vs ${secondId}`);

const all = await (await fetch(`${BASE}/api/environments`)).json();
const copies = all.environments.filter((e) => e.name === twin.name).length;
check("only one copy is on the page", copies === 1, `${copies} copies`);

// A different game with the same name is still its own game.
const other = await post("/api/environments", {
  ...twin,
  code: { ...CONNECT_FOUR.code, observe: CONNECT_FOUR.code.observe.replace("you_are", "seat_is") },
});
check(
  "a real change under the same name is a new game",
  other.body.environment?.id && other.body.environment.id !== firstId,
);

console.log(bad ? `\n${bad} failed` : "\nsaving a draft is quick and says it once");
process.exit(bad ? 1 : 0);
