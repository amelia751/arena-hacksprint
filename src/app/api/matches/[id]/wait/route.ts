import { waitForTurn } from "@/lib/match-service";
import { fromResult } from "@/lib/http";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(req.url);
  return fromResult(
    await waitForTurn({
      match_id: id,
      after_revision: Number(url.searchParams.get("after_revision") ?? 0),
      seat: url.searchParams.has("seat") ? Number(url.searchParams.get("seat")) : undefined,
      timeout_ms: url.searchParams.has("timeout_ms")
        ? Number(url.searchParams.get("timeout_ms"))
        : undefined,
    }),
  );
}
