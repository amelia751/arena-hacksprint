import { forkEnv } from "@/lib/env-service";
import { fromWrite, readBody } from "@/lib/http";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await readBody<{ name: string }>(req);
  return fromWrite(() => forkEnv({ source_id: id, name: body.name }));
}
