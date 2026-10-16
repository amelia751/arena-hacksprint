import { liveMatch, startMatch } from "@/lib/match-service";
import { json, readBody } from "@/lib/http";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("environment_id");
  return json(await liveMatch(id ?? undefined));
}

export async function POST(req: Request) {
  const body = await readBody<{
    environment_id: string;
    seat?: number;
    agent_label?: string;
    seed?: number;
  }>(req);
  try {
    return json(await startMatch(body));
  } catch (e) {
    const err = e as Error & { status?: number };
    const store = /store is unreachable|nothing was saved/.test(err.message);
    return json({ error: err.message }, err.status ?? (store ? 503 : 400));
  }
}
