import { takeAction } from "@/lib/match-service";
import { fromWrite, readBody } from "@/lib/http";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await readBody<{
    action: string;
    expected_revision: number;
    seat?: number;
    rationale?: string;
    confidence?: number;
    interface?: "human_ui" | "webmcp" | "bot";
    latency_ms?: number;
  }>(req);
  return fromWrite(() => takeAction({ match_id: id, ...body }));
}
