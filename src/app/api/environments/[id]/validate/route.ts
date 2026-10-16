import { validateEnv } from "@/lib/env-service";
import { fromResult, readBody } from "@/lib/http";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await readBody<{ episodes?: number }>(req);
  return fromResult(await validateEnv(id, body.episodes));
}
