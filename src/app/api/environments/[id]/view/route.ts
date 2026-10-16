import { previewEnv } from "@/lib/env-service";
import { fromResult } from "@/lib/http";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(req.url);
  const seed = Number(url.searchParams.get("seed") ?? 0);
  const seatParam = url.searchParams.get("seat");
  const seat = seatParam == null ? undefined : Number(seatParam);
  const moves = (url.searchParams.get("moves") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return fromResult(
    await previewEnv(id, {
      seed: Number.isFinite(seed) ? seed : 0,
      seat: seat != null && Number.isFinite(seat) ? seat : undefined,
      moves,
    }),
  );
}
