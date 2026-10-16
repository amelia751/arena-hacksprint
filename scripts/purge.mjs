/**
 * Empty the deployed store, for when you want a blank page to test against.
 *
 * Uses the Netlify CLI login already on this machine and prints no credentials.
 * Pass a prefix to narrow it: `node scripts/purge.mjs match/` clears matches and
 * leaves the games alone.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { getStore } from "@netlify/blobs";

const prefix = process.argv[2] ?? "";

const state = JSON.parse(await readFile(path.join(process.cwd(), ".netlify", "state.json"), "utf8"));
const cli = JSON.parse(
  await readFile(path.join(os.homedir(), "Library", "Preferences", "netlify", "config.json"), "utf8"),
);
const token = cli.users?.[Object.keys(cli.users ?? {})[0]]?.auth?.token ?? cli.accessToken;
if (!token) throw new Error("no Netlify CLI login found — run `netlify login`");

/** These two are finished. Nothing here removes them. */
const KEEP = ["env_775ebdbb", "env_f9705d3e"];

const store = getStore({ name: "arena", siteID: state.siteId, token, consistency: "strong" });
const { blobs } = await store.list({ prefix });

if (blobs.length === 0) {
  console.log(prefix ? `nothing under ${prefix}` : "the store is already empty");
  process.exit(0);
}

// Their matches and tapes are keyed by match id, so work out which matches
// belong to them before deciding what may go.
const spared = new Set(KEEP.map((id) => `env/${id}`));
for (const b of blobs) {
  if (!b.key.startsWith("match/")) continue;
  const match = await store.get(b.key, { type: "json" }).catch(() => null);
  if (!match || !KEEP.includes(match.environment_id)) continue;
  spared.add(b.key);
  spared.add(`steps/${match.id}`);
}

const going = blobs.filter((b) => !spared.has(b.key));
const kept = blobs.length - going.length;

if (going.length === 0) {
  console.log(`nothing to remove — all ${blobs.length} entries belong to games that stay`);
  process.exit(0);
}

await Promise.all(going.map((b) => store.delete(b.key)));
console.log(`removed ${going.length} ${going.length === 1 ? "entry" : "entries"}`);
if (kept > 0) console.log(`kept ${kept} belonging to the finished games`);
