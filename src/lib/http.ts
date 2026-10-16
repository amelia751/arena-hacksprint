export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function fromResult(result: unknown) {
  if (result && typeof result === "object" && "error" in result) {
    const row = result as { error?: string; status?: number };
    if (row.error) return json(result, typeof row.status === "number" ? row.status : 400);
  }
  return json(result);
}

/**
 * Anything that writes can now fail loudly rather than pretend it saved. Turn
 * that into an answer the page and the agent can both read, instead of a crash.
 */
export async function fromWrite(work: () => Promise<unknown>) {
  try {
    return fromResult(await work());
  } catch (err) {
    const message = err instanceof Error ? err.message : "the write did not go through";
    return json({ error: message, status: 503 }, 503);
  }
}

/**
 * A read that could not reach the store is not a missing page.
 *
 * Answering 404 would have the page tell somebody their game does not exist,
 * which is the one thing that is never true here — the game is on disk, we just
 * could not get to it. 503 says come back in a moment.
 */
export async function fromRead(work: () => Promise<unknown>) {
  try {
    return fromResult(await work());
  } catch (err) {
    const message = err instanceof Error ? err.message : "the store did not answer";
    return json({ error: message, status: 503 }, 503);
  }
}

export async function readBody<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}
