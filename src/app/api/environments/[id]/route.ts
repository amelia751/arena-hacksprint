import { getEnv, updateEnv } from "@/lib/env-service";
import { fromRead, fromWrite, readBody } from "@/lib/http";
import type { EnvCode } from "@/lib/types";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const fn = new URL(req.url).searchParams.get("fn") as keyof EnvCode | null;
  return fromRead(() => getEnv(id, fn ?? undefined));
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await readBody<{
    expected_revision: number;
    name?: string;
    description?: string;
    code?: Partial<EnvCode>;
  }>(req);
  return fromWrite(() =>
    updateEnv({
      id,
      expected_revision: body.expected_revision,
      name: body.name,
      description: body.description,
      code: body.code,
    }),
  );
}
