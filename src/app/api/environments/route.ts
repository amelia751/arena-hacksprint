import { createEnv, listEnvs } from "@/lib/env-service";
import { fromWrite, json, readBody } from "@/lib/http";

export async function GET() {
  return json(await listEnvs());
}

export async function POST(req: Request) {
  const body = await readBody<{
    name: string;
    description?: string;
    players?: number;
    code?: {
      init?: string;
      legal_actions?: string;
      observe?: string;
      step?: string;
      render?: string;
    };
  }>(req);
  return fromWrite(() => createEnv(body));
}
