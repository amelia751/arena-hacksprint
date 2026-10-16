import "server-only";
import { mkdir, readFile, rename, stat, writeFile } from "fs/promises";
import path from "path";
import type { Environment, Match, StepRecord } from "./types";

export type DB = {
  environments: Record<string, Environment>;
  matches: Record<string, Match>;
  steps: Record<string, StepRecord[]>;
};

const FILE = path.join(process.cwd(), ".data", "store.json");
const SERVERLESS = !!(
  process.env.NETLIFY ||
  process.env.VERCEL ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.LAMBDA_TASK_ROOT
);

/** Nothing ships with the page. Every game here was written by somebody. */
function empty(): DB {
  return { environments: {}, matches: {}, steps: {} };
}

function reconcile(db: DB): DB {
  db.environments = db.environments ?? {};
  db.matches = db.matches ?? {};
  db.steps = db.steps ?? {};
  for (const row of Object.values(db.environments)) row.kind = "authored";
  return db;
}

const newestFirst = (a: { created_at: string }, b: { created_at: string }) =>
  a.created_at < b.created_at ? 1 : -1;

/*
 * Each game, match and tape lives under its own key.
 *
 * They all used to share one document, which meant every save rewrote the whole
 * world. Two saves that overlapped — a move landing while the agent published,
 * say — would each write a copy of everything they had read, and whichever
 * finished last erased the other. The host offers a version check to guard
 * against that, but it does not hold under load: eight writers claiming the same
 * version were all told they had won. Separate keys sidestep the argument. Two
 * things that have nothing to do with each other no longer share a page.
 */
const ENV = "env/";
const MATCH = "match/";
const STEPS = "steps/";
const LEGACY = "db.json";

type BlobStore = {
  get: (key: string, options?: { type: "text" }) => Promise<string | null>;
  setJSON: (key: string, value: unknown) => Promise<unknown>;
  delete: (key: string) => Promise<void>;
  list: (options: { prefix: string }) => Promise<{ blobs: { key: string }[] }>;
};
type MakeStore = (opts: { name: string; consistency: string }) => unknown;
let makeStore: MakeStore | null = null;

/**
 * Build the client fresh every time.
 *
 * The host hands each invocation its own short-lived credentials, and a client
 * keeps whichever ones it was built with. Holding one across invocations means
 * holding a token past its expiry, and after that every read fails with
 * "Token expired" — the games are all still there, the page just cannot see
 * them. Building a client reads the current credentials and makes no network
 * call, so there is nothing to save by keeping it.
 */
async function blobs(): Promise<BlobStore | null> {
  if (!SERVERLESS) return null;
  try {
    makeStore ??= (await import("@netlify/blobs")).getStore as MakeStore;
    return makeStore({ name: "arena", consistency: "strong" }) as BlobStore;
  } catch {
    return null;
  }
}

const UNREACHABLE = "the store is unreachable, so nothing was saved";
let lastComplaint = 0;

/** Says why a read failed without touching the store that is already failing. */
function complain(err: unknown) {
  const now = Date.now();
  if (now - lastComplaint < 30_000) return;
  lastComplaint = now;
  console.error(`arena store: ${err instanceof Error ? err.message : String(err)}`);
}

/** Throws when the store did not answer. Null only when the key is not there. */
async function fetchKey<T>(key: string): Promise<T | null> {
  const store = await blobs();
  if (!store) throw new Error(UNREACHABLE);
  const raw = await store.get(key, { type: "text" });
  return raw ? (JSON.parse(raw) as T) : null;
}

/** The forgiving version: null whether it is missing or the store went quiet. */
async function readKey<T>(key: string): Promise<T | null> {
  try {
    return await fetchKey<T>(key);
  } catch (err) {
    complain(err);
    return null;
  }
}

/** A save that never landed must not report success. */
async function writeKey(key: string, value: unknown): Promise<void> {
  const store = await blobs();
  if (!store) throw new Error(UNREACHABLE);
  await store.setJSON(key, value);
}

/** Null means the store did not answer, which is not the same as nothing here. */
async function readAll<T>(prefix: string): Promise<T[] | null> {
  const store = await blobs();
  if (!store) return null;
  try {
    const { blobs: found } = await store.list({ prefix });
    // fetchKey throws rather than returning null, so one unreadable game fails
    // the whole list. A game we could not read is not a game that is gone, and
    // half a shelf is worse than the shelf we had a moment ago.
    const rows: (T | null)[] = await Promise.all(found.map((b) => fetchKey<T>(b.key)));
    return rows.filter((row): row is T => row !== null);
  } catch (err) {
    complain(err);
    return null;
  }
}

/*
 * Everything written before the split still lives in one document. Move it
 * across the first time somebody asks, so nobody loses a game to an upgrade.
 */
let migration: Promise<void> | null = null;

function migrate(): Promise<void> {
  migration ??= (async () => {
    const old = await readKey<DB>(LEGACY);
    if (!old) return;
    const db = reconcile(old);
    await Promise.all([
      ...Object.values(db.environments).map((e) => writeKey(ENV + e.id, e)),
      ...Object.values(db.matches).map((m) => writeKey(MATCH + m.id, m)),
      ...Object.entries(db.steps).map(([id, tape]) => writeKey(STEPS + id, tape)),
    ]);
    const store = await blobs();
    await store?.delete(LEGACY);
  })().catch((err) => {
    complain(err);
    migration = null;
  });
  return migration;
}

/*
 * Two open tabs poll this every couple of seconds. Holding the answer for a
 * moment, and sharing one trip between callers who arrive together, is the
 * difference between a busy store and a failing one.
 */
const READ_TTL = 750;
const cache = new Map<string, { at: number; rows: unknown[] }>();
const inFlight = new Map<string, Promise<unknown[]>>();

async function listCached<T>(prefix: string): Promise<T[]> {
  const hit = cache.get(prefix);
  if (hit && Date.now() - hit.at < READ_TTL) return hit.rows as T[];

  let pending = inFlight.get(prefix);
  if (!pending) {
    pending = migrate()
      .then(() => readAll<T>(prefix))
      .then((rows) => {
        // Remember only an answer the store actually gave. A store that really
        // is empty is worth caching; a store that would not answer is not, and
        // until it does, the shelf we had a moment ago beats a blank page.
        if (rows) cache.set(prefix, { at: Date.now(), rows });
        return (rows ?? hit?.rows ?? []) as unknown[];
      })
      .finally(() => inFlight.delete(prefix));
    inFlight.set(prefix, pending);
  }
  return (await pending) as T[];
}

function forget(prefix: string) {
  cache.delete(prefix);
}

// ── The local file, for a single process on somebody's laptop ────────────────

let mem: DB | null = null;
let memMtime = 0;
let writeChain: Promise<void> = Promise.resolve();

async function loadFile(): Promise<DB> {
  let mtime = 0;
  try {
    mtime = (await stat(/*turbopackIgnore: true*/ FILE)).mtimeMs;
  } catch {
    mtime = 0;
  }
  if (mem && mtime && mtime === memMtime) return mem;
  try {
    const raw = await readFile(/*turbopackIgnore: true*/ FILE, "utf8");
    mem = reconcile(JSON.parse(raw) as DB);
    memMtime = mtime;
    return mem;
  } catch {
    mem = empty();
    await persistFile(mem);
    return mem;
  }
}

async function persistFile(db: DB) {
  mem = db;
  try {
    await mkdir(path.dirname(FILE), { recursive: true });
    const tmp = FILE + ".tmp";
    await writeFile(/*turbopackIgnore: true*/ tmp, JSON.stringify(db), "utf8");
    await rename(/*turbopackIgnore: true*/ tmp, FILE);
    memMtime = (await stat(/*turbopackIgnore: true*/ FILE)).mtimeMs;
  } catch {
    // Read-only hosts fall back to process memory.
  }
}

function editFile<T>(fn: (db: DB) => T): Promise<T> {
  const run = writeChain.then(async () => {
    const db = await loadFile();
    const result = fn(db);
    await persistFile(db);
    return result;
  });
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// ── What the rest of the app uses ────────────────────────────────────────────

export async function listEnvironments(): Promise<Environment[]> {
  if (SERVERLESS) {
    const rows = await listCached<Environment>(ENV);
    for (const row of rows) row.kind = "authored";
    return [...rows].sort(newestFirst);
  }
  const db = await loadFile();
  return Object.values(db.environments).sort(newestFirst);
}

export async function getEnvironment(id: string): Promise<Environment | null> {
  if (SERVERLESS) {
    await migrate();
    // Throws rather than answering "no such game" when the store is quiet.
    // Telling somebody their game does not exist is the one wrong answer here.
    const row = await fetchKey<Environment>(ENV + id);
    if (row) row.kind = "authored";
    return row;
  }
  const db = await loadFile();
  return db.environments[id] ?? null;
}

export async function putEnvironment(env: Environment): Promise<Environment> {
  if (SERVERLESS) {
    await migrate();
    await writeKey(ENV + env.id, env);
    forget(ENV);
    return env;
  }
  return editFile((db) => {
    db.environments[env.id] = env;
    return env;
  });
}

export async function getMatch(id: string): Promise<Match | null> {
  if (SERVERLESS) {
    await migrate();
    return readKey<Match>(MATCH + id);
  }
  const db = await loadFile();
  return db.matches[id] ?? null;
}

export async function putMatch(match: Match): Promise<Match> {
  if (SERVERLESS) {
    await migrate();
    await writeKey(MATCH + match.id, match);
    forget(MATCH);
    return match;
  }
  return editFile((db) => {
    db.matches[match.id] = match;
    return match;
  });
}

export async function listMatches(environmentId?: string): Promise<Match[]> {
  if (SERVERLESS) {
    const rows = await listCached<Match>(MATCH);
    return rows
      .filter((m) => !environmentId || m.environment_id === environmentId)
      .sort(newestFirst);
  }
  const db = await loadFile();
  return Object.values(db.matches)
    .filter((m) => !environmentId || m.environment_id === environmentId)
    .sort(newestFirst);
}

export async function listSteps(matchId: string): Promise<StepRecord[]> {
  if (SERVERLESS) {
    await migrate();
    return (await readKey<StepRecord[]>(STEPS + matchId)) ?? [];
  }
  const db = await loadFile();
  return db.steps[matchId] ?? [];
}

/*
 * A tape only ever grows, and only from the match it belongs to, so the two
 * seats taking turns are the only writers. Reading it back before adding to it
 * keeps a move from landing on a copy that is missing the one before it.
 */
async function appendToTape(matchId: string, step: StepRecord): Promise<StepRecord> {
  const key = STEPS + matchId;
  const tape = (await readKey<StepRecord[]>(key)) ?? [];
  tape.push(step);
  await writeKey(key, tape);
  return step;
}

export async function appendStep(step: StepRecord): Promise<StepRecord> {
  if (SERVERLESS) {
    await migrate();
    return appendToTape(step.match_id, step);
  }
  return editFile((db) => {
    const list = db.steps[step.match_id] ?? [];
    list.push(step);
    db.steps[step.match_id] = list;
    return step;
  });
}

export async function replaceMatchAndStep(
  match: Match,
  step: StepRecord,
): Promise<{ match: Match; step: StepRecord }> {
  if (SERVERLESS) {
    await migrate();
    // The tape first: a move that is recorded but not yet reflected in the
    // match reads as a slow save, where the reverse reads as a lost move.
    await appendToTape(match.id, step);
    await writeKey(MATCH + match.id, match);
    forget(MATCH);
    return { match, step };
  }
  return editFile((db) => {
    db.matches[match.id] = match;
    const list = db.steps[match.id] ?? [];
    list.push(step);
    db.steps[match.id] = list;
    return { match, step };
  });
}
