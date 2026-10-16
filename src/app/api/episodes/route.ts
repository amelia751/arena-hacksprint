import { exportEpisodes } from "@/lib/match-service";
import { json } from "@/lib/http";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const result = await exportEpisodes({
    environment_id: url.searchParams.get("environment_id") ?? undefined,
    match_id: url.searchParams.get("match_id") ?? undefined,
  });
  if (url.searchParams.get("format") === "jsonl") {
    return new Response(result.jsonl + "\n", {
      headers: {
        "content-type": "application/x-ndjson",
        "content-disposition": "attachment; filename=arena-episodes.jsonl",
      },
    });
  }
  return json(result);
}
