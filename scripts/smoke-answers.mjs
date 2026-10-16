#!/usr/bin/env node
/**
 * Every write tool answers with JSON, and an agent's next call depends on the id
 * and revision inside it. Answers get shortened to fit a budget, so this walks a
 * whole authoring run and checks that what comes back still parses and still
 * carries the fields the next step needs.
 */
import { chromium } from "playwright";
import { CONNECT_FOUR, forget } from "./fixtures.mjs";

const BASE = process.argv[2] || process.env.ARENA_BASE || "http://localhost:3000";

const browser = await chromium.launch({
  headless: true,
  args: ["--enable-experimental-web-platform-features", "--enable-features=WebMCPTesting"],
});
const page = await browser.newPage();
await page.goto(BASE, { waitUntil: "networkidle" });

const call = (n, a) =>
  page.evaluate(
    async ([name, args]) => {
      const ctx = document.modelContext;
      const tool = (await ctx.getTools()).find((t) => t.name === name);
      if (!tool) return `no tool named ${name}`;
      return ctx.executeTool(tool, JSON.stringify(args));
    },
    [n, a],
  );

let failures = 0;
const created = [];

/** Tool answers open with JSON and may carry a hint after it. */
function parse(out) {
  for (const candidate of [String(out).split("\n")[0], String(out)]) {
    if (!candidate.startsWith("{")) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      /* try the whole thing */
    }
  }
  return null;
}

function check(label, out, want) {
  const parsed = parse(out);
  if (!parsed) {
    failures++;
    console.log(`FAIL ${label} — the answer is not parseable JSON`);
    console.log(`     ${String(out).slice(-140)}`);
    return null;
  }
  const missing = want.filter((path) =>
    path.split(".").reduce((v, k) => (v == null ? v : v[k]), parsed) == null,
  );
  const mangled = want.filter((path) => {
    const v = path.split(".").reduce((a, k) => (a == null ? a : a[k]), parsed);
    return typeof v === "string" && /^\[omitted|^…|…$/.test(v);
  });
  if (missing.length || mangled.length) {
    failures++;
    console.log(
      `FAIL ${label} — ${[
        missing.length ? `missing ${missing.join(", ")}` : "",
        mangled.length ? `shortened away ${mangled.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("; ")}`,
    );
    return parsed;
  }
  console.log(`ok   ${label}`);
  return parsed;
}

// A deliberately wordy game, so every answer is pushed against its budget.
const bulky = {
  ...CONNECT_FOUR.code,
  render: CONNECT_FOUR.code.render.replace(
    "var css =",
    `var _pad = ${JSON.stringify("padding ".repeat(9000))};\n  var css =`,
  ),
};

const made = check(
  "create_environment keeps the id",
  await call("create_environment", {
    name: "Answer Probe",
    description: "a wordy game, so the answer is squeezed against its budget",
    players: 2,
    code: bulky,
  }),
  ["environment.id", "environment.revision", "environment.validation"],
);

const id = made?.environment?.id;
if (id) {
  created.push(id);

  check(
    "update_environment keeps the revision",
    await call("update_environment", {
      id,
      expected_revision: made.environment.revision,
      description: "revised",
      code: { render: bulky.render },
    }),
    ["environment.id", "environment.revision"],
  );

  // This one answers flat rather than under an environment key.
  check("validate_environment keeps the report", await call("validate_environment", { id }), [
    "id",
    "revision",
    "validation.checks",
  ]);

  const forked = check(
    "fork_environment keeps the new id",
    await call("fork_environment", { source_id: id, name: "Answer Probe Copy" }),
    ["environment.id", "environment.revision"],
  );
  if (forked?.environment?.id) created.push(forked.environment.id);

  // Far more code than any budget can hold, so shortening has to go all the way
  // down. The id still has to survive it. This one answers flat, like validate.
  const latest = check(
    "get_environment survives an answer far over budget",
    await call("get_environment", { id }),
    ["id", "revision", "code_hash"],
  );
  const revision = latest?.revision ?? 2;
  await call("preview_view", { environment_id: id, moves: ["col_3", "col_4"] });
  check(
    "publish_environment keeps the id",
    await call("publish_environment", {
      id,
      expected_revision: revision,
      confirm_info_flow: true,
    }),
    ["environment.id", "environment.published"],
  );
}

await browser.close();
await forget(created);
console.log(failures ? `\n${failures} failed` : "\nevery answer parses and keeps its id");
process.exit(failures ? 1 : 0);
