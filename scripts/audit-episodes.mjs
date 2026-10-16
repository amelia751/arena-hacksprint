#!/usr/bin/env node
/**
 * Reads back what a finished match actually recorded. The dataset is the point
 * of the whole thing, so every claim the schema makes about a row is checked
 * against the bytes the download serves.
 *
 *   node scripts/audit-episodes.mjs <base> <match_id>
 */
const BASE = process.argv[2] || process.env.ARENA_BASE || "http://localhost:3000";
const MATCH = process.argv[3];

let bad = 0;
const check = (what, ok, detail) => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail != null ? ` — ${detail}` : ""}`);
};

const q = MATCH ? `match_id=${MATCH}` : "";
const asJson = await fetch(`${BASE}/api/episodes?${q}`).then((r) => r.json());
const raw = await fetch(`${BASE}/api/episodes?${q}&format=jsonl`);
const text = await raw.text();

check("the download serves ndjson", raw.headers.get("content-type")?.includes("x-ndjson"), raw.headers.get("content-type"));
check(
  "it downloads as a named file",
  /filename=.+\.jsonl/.test(raw.headers.get("content-disposition") || ""),
  raw.headers.get("content-disposition"),
);

const lines = text.trim().split("\n").filter(Boolean);
let parsed = [];
try {
  parsed = lines.map((l) => JSON.parse(l));
  check("every line is its own json object", true, `${lines.length} lines`);
} catch (e) {
  check("every line is its own json object", false, e.message);
}
check(
  "the json and jsonl views agree",
  parsed.length === (asJson.records?.length ?? -1),
  `jsonl ${parsed.length} vs json ${asJson.records?.length}`,
);

const episodes = parsed.filter((r) => r.type === "episode");
const steps = parsed.filter((r) => r.type === "step");
check("something was recorded", episodes.length > 0 && steps.length > 0, `${episodes.length} episodes, ${steps.length} steps`);
check("nothing is untyped", episodes.length + steps.length === parsed.length);

for (const ep of episodes) {
  const mine = steps.filter((s) => s.match_id === ep.match_id);
  const tag = ep.match_id;

  check(`${tag}: header names its schema`, ep.schema_version === "arena-1", ep.schema_version);
  check(
    `${tag}: header pins the code that ran`,
    /^sha256:[0-9a-f]{64}$/.test(ep.environment?.code_hash || ""),
    ep.environment?.code_hash?.slice(0, 22),
  );
  check(`${tag}: header records the checks passed`, ep.environment?.validation === "pass", ep.environment?.validation);
  check(`${tag}: header pins a revision`, Number.isInteger(ep.environment?.revision), ep.environment?.revision);
  check(`${tag}: the seed is kept`, Number.isFinite(ep.seed), ep.seed);
  check(`${tag}: length matches the rows`, ep.length === mine.length, `${ep.length} vs ${mine.length}`);
  check(
    `${tag}: both seats are described`,
    Array.isArray(ep.seats) && ep.seats.length >= 2 && ep.seats.every((s) => s.player_type && s.interface),
    JSON.stringify(ep.seats),
  );
  check(
    `${tag}: a person and an agent both played`,
    new Set(ep.seats.map((s) => s.player_type)).size === 2,
    ep.seats.map((s) => s.player_type).join("/"),
  );

  // Indices, revisions and turn order have to line up or the file is not replayable.
  check(`${tag}: rows are numbered 0..n`, mine.every((s, i) => s.index === i), mine.map((s) => s.index).join(","));
  const revs = mine.map((s) => s.revision);
  check(`${tag}: revisions only go up`, revs.every((r, i) => i === 0 || r > revs[i - 1]), revs.join(","));
  check(
    `${tag}: the seat that moved is the seat that observed`,
    mine.every((s) => s.observation?.to_move == null || s.observation.to_move === s.seat),
    mine.map((s) => `${s.seat}:${s.observation?.to_move}`).join(" "),
  );

  for (const s of mine) {
    const at = `${tag} row ${s.index}`;
    check(`${at}: the move was legal`, Array.isArray(s.legal_actions) && s.legal_actions.includes(s.action), `${s.action} of ${s.legal_actions?.length}`);
    check(
      `${at}: presented_order is a shuffle of the same choices`,
      Array.isArray(s.presented_order) &&
        s.presented_order.length === s.legal_actions.length &&
        new Set(s.presented_order).size === s.legal_actions.length &&
        s.presented_order.every((i) => Number.isInteger(i) && i >= 0 && i < s.legal_actions.length),
      JSON.stringify(s.presented_order),
    );
    check(`${at}: forced is honest`, s.forced === (s.legal_actions.length === 1), `${s.forced} with ${s.legal_actions.length}`);
    check(`${at}: it kept what the player saw`, s.observation != null && Object.keys(s.observation).length > 0);
    check(`${at}: the interface is named`, ["webmcp", "human_ui"].includes(s.interface), s.interface);
    check(`${at}: a decision time is recorded`, Number.isFinite(s.latency_ms) && s.latency_ms >= 0, s.latency_ms);
    check(`${at}: reward is a number`, Number.isFinite(s.reward), s.reward);
  }

  const agentRows = mine.filter((s) => s.interface === "webmcp");
  const humanRows = mine.filter((s) => s.interface === "human_ui");
  check(`${tag}: both sides are in the file`, agentRows.length > 0 && humanRows.length > 0, `${agentRows.length} agent, ${humanRows.length} human`);
  check(
    `${tag}: agent rows read as thinking time, not sandbox time`,
    agentRows.length === 0 || agentRows.some((s) => s.latency_ms > 200),
    agentRows.map((s) => s.latency_ms).join(","),
  );
  const reasoned = agentRows.filter((s) => s.rationale);
  console.log(`     ${reasoned.length}/${agentRows.length} agent rows carry a rationale`);

  // The episode's returns are the claim; the last row's terminal is the evidence.
  const last = mine[mine.length - 1];
  check(`${tag}: the last row ends the game`, last?.terminal === true, last?.terminal);
  check(
    `${tag}: returns are one number per seat`,
    Array.isArray(ep.returns) && ep.returns.length === ep.seats.length && ep.returns.every(Number.isFinite),
    JSON.stringify(ep.returns),
  );
  check(
    `${tag}: it is zero-sum`,
    ep.returns.reduce((a, b) => a + b, 0) === 0,
    ep.returns.join("+"),
  );
  check(
    `${tag}: the winner's last reward agrees with returns`,
    ep.returns[last.seat] === last.reward,
    `seat ${last.seat}: return ${ep.returns[last.seat]} vs row ${last.reward}`,
  );
}

console.log(bad ? `\n${bad} failed` : "\nthe recording holds up");
process.exit(bad ? 1 : 0);
