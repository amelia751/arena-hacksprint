import { botMove } from "@/lib/match-service";
import { fromWrite } from "@/lib/http";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return fromWrite(() => botMove(id));
}
