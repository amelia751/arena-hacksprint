import { clearTrace, recentTrace, trace } from "@/lib/trace";
import { json, readBody } from "@/lib/http";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const rows = await recentTrace(Number(url.searchParams.get("limit") ?? 200));
  if (url.searchParams.get("format") === "jsonl") {
    return new Response(rows.map((r) => JSON.stringify(r)).join("\n") + "\n", {
      headers: { "content-type": "application/x-ndjson" },
    });
  }
  return json({ count: rows.length, entries: rows });
}

/** The page reports what happened inside a browser we cannot open ourselves. */
export async function POST(req: Request) {
  const body = await readBody<{ event?: string; [k: string]: unknown }>(req);
  const { event, ...rest } = body ?? {};
  if (!event) return json({ error: "event is required" }, 400);
  const capped: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest).slice(0, 12)) {
    capped[k] = typeof v === "string" ? v.slice(0, 500) : v;
  }
  trace(String(event).slice(0, 60), capped);
  // Nothing reads this answer, and an unread body is a connection the browser
  // holds open. Say nothing at all.
  return new Response(null, { status: 204 });
}

export async function DELETE() {
  await clearTrace();
  return json({ ok: true });
}
