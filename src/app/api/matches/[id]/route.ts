import { getMatch, listSteps } from "@/lib/store";
import { json } from "@/lib/http";
import { publicMatch } from "@/lib/match-service";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const match = await getMatch(id);
  if (!match) return json({ error: "match not found" }, 404);
  const steps = await listSteps(id);
  return json({ match: publicMatch(match), steps });
}
