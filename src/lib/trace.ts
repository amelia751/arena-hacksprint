import "server-only";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";

/**
 * A flight recorder for sessions nobody is watching.
 *
 * Most of what goes wrong here goes wrong inside somebody else's browser, in a
 * chat window we cannot see, and the person on the other end should not have to
 * play detective. Every tool call and every match event lands here with its
 * timing and outcome, so a session can be read back afterwards instead of
 * reconstructed from memory. It also prints one line per entry, which is what
 * shows up in the host's log stream while a session is live.
 */

export type TraceEntry = {
  at: string;
  event: string;
  [key: string]: unknown;
};

const KEEP = 500;
const FILE = path.join(process.cwd(), ".data", "trace.json");
const SERVERLESS = !!(
  process.env.NETLIFY ||
  process.env.VERCEL ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.LAMBDA_TASK_ROOT
);
const BLOB_KEY = "trace.json";

let mem: TraceEntry[] = [];
let chain: Promise<void> = Promise.resolve();

type BlobStore = {
  get: (key: string) => Promise<string | null>;
  setJSON: (key: string, value: unknown) => Promise<unknown>;
};
type MakeStore = (opts: { name: string; consistency: string }) => unknown;
let makeStore: MakeStore | null = null;

/** Built fresh each time, for the same reason as the store: tokens expire. */
async function blobs(): Promise<BlobStore | null> {
  if (!SERVERLESS) return null;
  try {
    makeStore ??= (await import("@netlify/blobs")).getStore as MakeStore;
    // Its own store. The recorder rewrites its whole log on every entry, and it
    // must never be the reason a game fails to save.
    return makeStore({ name: "arena-trace", consistency: "strong" }) as BlobStore;
  } catch {
    return null;
  }
}

async function read(): Promise<TraceEntry[]> {
  if (SERVERLESS) {
    const store = await blobs();
    if (store) {
      try {
        const raw = await store.get(BLOB_KEY);
        if (raw) return JSON.parse(raw) as TraceEntry[];
      } catch {
        /* an unreadable recorder must not take the page down */
      }
    }
    return mem;
  }
  try {
    return JSON.parse(await readFile(/*turbopackIgnore: true*/ FILE, "utf8")) as TraceEntry[];
  } catch {
    return [];
  }
}

async function write(rows: TraceEntry[]) {
  mem = rows;
  if (SERVERLESS) {
    const store = await blobs();
    if (store) await store.setJSON(BLOB_KEY, rows).catch(() => undefined);
    return;
  }
  try {
    await mkdir(path.dirname(FILE), { recursive: true });
    const tmp = FILE + ".tmp";
    await writeFile(/*turbopackIgnore: true*/ tmp, JSON.stringify(rows), "utf8");
    await rename(/*turbopackIgnore: true*/ tmp, FILE);
  } catch {
    /* read-only hosts keep it in memory for this instance */
  }
}

/** Nothing here is worth a stack trace, and nothing here should ever throw. */
export function trace(event: string, fields: Record<string, unknown> = {}): void {
  const entry: TraceEntry = { at: new Date().toISOString(), event, ...fields };
  try {
    console.log(`arena ${JSON.stringify(entry)}`);
  } catch {
    console.log(`arena ${event}`);
  }
  chain = chain.then(async () => {
    const rows = await read();
    rows.push(entry);
    await write(rows.slice(-KEEP));
  }).catch(() => undefined);
}

export async function recentTrace(limit = 200): Promise<TraceEntry[]> {
  const rows = await read();
  return rows.slice(-Math.max(1, Math.min(limit, KEEP)));
}

export async function clearTrace(): Promise<void> {
  await write([]);
}
