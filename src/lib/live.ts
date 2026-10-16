/**
 * The page the person is looking at has to track writes the agent just made.
 * router.refresh() is one path; it is not reliable in every host browser, so
 * anything that paints from the store also listens here and re-fetches.
 */

type Reloader = () => Promise<void>;

const reloaders = new Set<Reloader>();

export function registerLive(fn: Reloader): () => void {
  reloaders.add(fn);
  return () => {
    reloaders.delete(fn);
  };
}

export async function reloadLive(): Promise<void> {
  await Promise.all([...reloaders].map((fn) => fn().catch(() => undefined)));
}
