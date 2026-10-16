/**
 * Ask the browser to hand the page to the person for the length of `work`.
 *
 * Some agents advertise requestUserInteraction and throw when it is called.
 * That is not a reason to abort
 * the wait — the wait itself is what keeps the assistant in the game.
 */
export async function withHandOver<T>(
  run:
    | { requestUserInteraction?: (fn: () => Promise<unknown>) => Promise<unknown> }
    | undefined,
  work: () => Promise<T>,
): Promise<T> {
  const ask = run?.requestUserInteraction;
  try {
    return (typeof ask === "function" ? await ask(work) : await work()) as T;
  } catch {
    return work();
  }
}
