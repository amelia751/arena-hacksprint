/**
 * The page, the agent and the bot all write to the store at once.
 *
 * Everything used to share one document, so two saves that overlapped would
 * each write back the whole world and the slower one would erase the other —
 * a game vanishing, a move that never happened. These are the cases that has to
 * survive, using a stub that races the way the real store does.
 */
process.env.NETLIFY = "1";

const { control } = await import("./blobs-stub.mjs");
const store = await import("../src/lib/store.ts");

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

function env(id, name = id) {
  return {
    id,
    name,
    description: name,
    code: "",
    players: 2,
    revision: 1,
    published: false,
    created_at: new Date(Date.now() + id.length).toISOString(),
    kind: "authored",
  };
}
const match = (id, environment_id) => ({
  id,
  environment_id,
  created_at: new Date().toISOString(),
  terminal: false,
});
const step = (match_id, n) => ({ match_id, n });

const settle = () => new Promise((r) => setTimeout(r, 900));
const names = async () => (await store.listEnvironments()).map((e) => e.name).sort().join(",");

// ── Anything written before the split is carried across ──────────────────────
// First, because moving the old document across happens once per instance.
control.reset();
control.seed("db.json", {
  environments: { old: env("old", "Older Game") },
  matches: { om: match("om", "old") },
  steps: { om: [step("om", 0)] },
});
const carried = await store.getEnvironment("old");
check("an older game is still there after the split", carried?.name === "Older Game");
check("its match came across too", (await store.getMatch("om"))?.id === "om");
check("its tape came across too", (await store.listSteps("om")).length === 1);
check("the old document is gone", control.raw("db.json") === null);

// ── Games written at the same time all survive ───────────────────────────────
control.reset();
await Promise.all(
  Array.from({ length: 12 }, (_, i) => store.putEnvironment(env(`e${i}`, `Race ${i}`))),
);
await settle();
const survived = (await store.listEnvironments()).length;
check("twelve games written at once all survive", survived === 12, `${survived} of 12`);

// ── A game and a move at the same time do not touch each other ───────────────
control.reset();
await store.putEnvironment(env("a"));
await store.putMatch(match("m1", "a"));
await settle();
await Promise.all([
  store.putEnvironment(env("b")),
  store.appendStep(step("m1", 1)),
  store.putMatch({ ...match("m1", "a"), terminal: true }),
  store.putEnvironment(env("c")),
]);
await settle();
check("neither game was lost to the move", (await names()) === "a,b,c", await names());
const tape = (await store.listSteps("m1")).length;
check("the move was recorded", tape === 1, `${tape} steps`);

// ── A tape keeps every move, in order ────────────────────────────────────────
control.reset();
for (let n = 0; n < 5; n++) await store.appendStep(step("m2", n));
const ns = (await store.listSteps("m2")).map((s) => s.n).join(",");
check("every move is on the tape, in order", ns === "0,1,2,3,4", `tape is ${ns}`);

// ── A move and the match result land together ────────────────────────────────
control.reset();
await store.replaceMatchAndStep({ ...match("m3", "a"), terminal: true }, step("m3", 9));
const m3 = await store.getMatch("m3");
const t3 = await store.listSteps("m3");
check("the result and the final move both landed", m3?.terminal === true && t3.length === 1);

// ── A save that never lands must not report success ──────────────────────────
control.reset();
control.failWrites = true;
let threw = null;
try {
  await store.putEnvironment(env("d"));
} catch (err) {
  threw = err;
}
check("a failed save is reported", threw !== null, threw ? "" : "it claimed success");

// ── Reading may be stale, but must not throw ─────────────────────────────────
control.reset();
await store.putEnvironment(env("a"));
await settle();
control.failReads = true;
let readThrew = null;
try {
  await store.listEnvironments();
} catch (err) {
  readThrew = err;
}
check("reads survive an outage", readThrew === null, String(readThrew ?? ""));
control.failReads = false;

// ── Polling must not cost a round trip every time ────────────────────────────
control.reset();
await store.putEnvironment(env("a"));
await settle();
const before = control.reads;
await Promise.all([
  store.listEnvironments(),
  store.listEnvironments(),
  store.listEnvironments(),
  store.listEnvironments(),
]);
const spent = control.reads - before;
check("four simultaneous polls share one trip", spent <= 2, `used ${spent} reads`);

// ── The client must not be kept across calls ─────────────────────────────────
// The host hands each invocation a short-lived token and the client holds the
// one it was built with. Reusing a client means using a token past its expiry,
// after which every read fails and the page looks empty.
control.reset();
await store.putEnvironment(env("a"));
await settle();
const built = control.built;
await store.putEnvironment(env("b"));
await settle();
await store.listEnvironments();
check("a fresh client is built each time", control.built > built, `${control.built - built} built`);

// ── An outage must not look like an empty shelf ──────────────────────────────
control.reset();
await store.putEnvironment(env("a"));
await store.putEnvironment(env("b"));
await settle();
await store.listEnvironments(); // the last good answer
control.failReads = true;
await settle(); // and let it go stale
const during = await store.listEnvironments();
check("an outage still shows the games we had", during.length === 2, `showed ${during.length}`);

// ── An outage must not claim a game is gone ──────────────────────────────────
let denied = null;
try {
  await store.getEnvironment("a");
} catch (err) {
  denied = err;
}
check("an outage does not say the game is missing", denied !== null, denied ? "" : "it said no such game");
control.failReads = false;

// ── A store that really is empty says so ─────────────────────────────────────
control.reset();
await settle();
const none = await store.listEnvironments();
check("an empty store reads as empty", none.length === 0, `${none.length} games`);

console.log(failures ? `\n${failures} failed` : "\nstore holds up");
process.exit(failures ? 1 : 0);
