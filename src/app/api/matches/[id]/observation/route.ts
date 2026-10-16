import { getObservation } from "@/lib/match-service";
import { fromResult } from "@/lib/http";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const raw = new URL(req.url).searchParams.get("seat");
  const seat = raw === null || raw === "" ? undefined : Number(raw);
  return fromResult(await getObservation(id, Number.isFinite(seat) ? seat : undefined));
}
