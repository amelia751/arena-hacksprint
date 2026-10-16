import { traceEnv } from "@/lib/env-service";
import { fromResult, readBody } from "@/lib/http";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await readBody<{ seed?: number; actions?: string[]; max_steps?: number }>(req);
  return fromResult(
    await traceEnv(id, {
      seed: Number.isFinite(body.seed) ? body.seed : 0,
      actions: Array.isArray(body.actions) ? body.actions.map(String) : [],
      max_steps: Number.isFinite(body.max_steps) ? body.max_steps : undefined,
    }),
  );
}
