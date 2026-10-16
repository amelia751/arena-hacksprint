#!/usr/bin/env node
/**
 * Game code is hostile until proven otherwise, so this one is hostile on purpose.
 *
 * Its init() climbs out of its vm context into the runtime process, then looks
 * for credentials and tries to reach the internet. The context is not the
 * boundary; the Daytona sandbox is. Every finding has to come back empty, and
 * a game that kills the runtime must not take the next game down with it.
 *
 *   npm run check:runtime            # against http://localhost:3000
 *   ARENA_BASE=https://… npm run check:runtime
 */
import { TICTACTOE } from "./fixtures.mjs";

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
  return res.json();
};

const tiny = (init, name) => ({
  name,
  description: "A one-move game used to probe the runtime.",
  players: 2,
  code: {
    init,
    legal_actions: `function legal_actions(state, player) { return ["end"]; }`,
    observe: `function observe(state, player) { return { findings: state.findings }; }`,
    step: `function step(state, action) {
  return { state: { to_move: 0, rng_cursor: state.rng_cursor, findings: state.findings }, rewards: [0, 0], terminal: true };
}`,
    render: `function render(o) { return { html: '<button data-action="end">end</button>', css: "" }; }`,
  },
});

const ESCAPE = `function init(seed) {
  var found = { escaped: false };
  try {
    var host = this.constructor.constructor("return process")();
    found.escaped = true;
    found.secret_names = Object.keys(host.env).filter(function (k) { return /KEY|SECRET|TOKEN|PASSWORD/i.test(k); });
    try {
      var cp = host.getBuiltinModule("child_process");
      found.egress = String(cp.execSync("curl -s -m 4 -o /dev/null -w '%{http_code}' https://example.com || echo blocked")).trim();
    } catch (e) { found.egress = "blocked (" + String(e.message).slice(0, 60) + ")"; }
  } catch (e) { found.why = String(e.message).slice(0, 80); }
  return { to_move: 0, rng_cursor: seed, findings: found };
}`;

const run = Date.now().toString(36);
const created = await post("/api/environments", tiny(ESCAPE, `Runtime probe ${run}`));
const id = created.environment?.id;
check("the probe saved as a draft", !!id, id);

const trace = await post(`/api/environments/${id}/trace`, { seed: 1, max_steps: 1 });
const row = trace.rows?.[0] ?? trace.trace?.rows?.[0];
const findings = JSON.parse(row?.observation ?? row?.state ?? "{}").findings ?? {};
console.log("     what the hostile init() found:", JSON.stringify(findings));
check(
  "no credential is visible inside the sandbox",
  !findings.secret_names || findings.secret_names.length === 0,
  findings.secret_names ? findings.secret_names.join(", ") || "none" : "context held",
);
check(
  "the sandbox has no route to the internet",
  !findings.egress || !/^[1-5]\d\d$/.test(findings.egress) || findings.egress === "000",
  findings.egress ?? "context held",
);

const KILL = `function init(seed) {
  try { this.constructor.constructor("return process")().exit(1); } catch (e) {}
  return { to_move: 0, rng_cursor: seed, findings: {} };
}`;
const killer = await post("/api/environments", tiny(KILL, `Runtime killer ${run}`));
await post(`/api/environments/${killer.environment?.id}/trace`, { seed: 1, max_steps: 1 });

const plain = await post("/api/environments", { ...TICTACTOE, name: `Tic-tac-toe ${run}` });
const again = await post(`/api/environments/${plain.environment?.id}/validate`, {});
const v0 = (again.validation ?? again).checks?.find((c) => c.id === "V0");
const v2 = (again.validation ?? again).checks?.find((c) => c.id === "V2");
check("after a game kills the runtime, the next game still runs", v0?.ok === true, v0?.ok ? v0.summary : v0?.detail ?? v0?.summary);
check("validation names the Daytona sandbox", /Daytona sandbox/.test(v2?.summary ?? ""), v2?.summary);

console.log(bad ? `\n${bad} check(s) failed` : "\nthe sandbox held");
process.exit(bad ? 1 : 0);
