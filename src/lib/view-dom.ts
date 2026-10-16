import { snapshotOffscreen, type SnapshotOptions } from "./view-frame";
import type { Projection } from "./view-project";
import type { AuthoredView } from "./view";

export type { Projection };

type LiveTable = {
  environment_id: string;
  match_id: string | null;
  snapshot: (opts?: SnapshotOptions) => Promise<Projection>;
  legal: () => string[];
  varied: () => boolean;
};

let live: LiveTable | null = null;

export function registerLiveTable(table: LiveTable | null) {
  live = table;
}

export function liveTable(): LiveTable | null {
  return live;
}

export async function snapshotLiveTable(): Promise<
  (Projection & { environment_id: string; match_id: string | null }) | null
> {
  if (!live) return null;
  const snap = await live.snapshot({ legal: live.legal(), varied: live.varied() });
  return { ...snap, environment_id: live.environment_id, match_id: live.match_id };
}

/**
 * The table mounts in an opaque-origin frame, so nothing inside it can see the
 * page it sits on. Read the host's own tokens here and report them, rather than
 * writing a palette into the guide that drifts the moment the CSS changes.
 */
export function surroundings(): string | null {
  if (typeof document === "undefined") return null;
  const css = getComputedStyle(document.documentElement);
  const token = (name: string) => css.getPropertyValue(name).trim() || null;
  const parts = [
    ["page", token("--page")],
    ["ink", token("--ink")],
    ["muted", token("--muted")],
    ["rule", token("--line")],
    ["accent", token("--accent")],
  ].filter(([, v]) => v) as Array<[string, string]>;
  const width = Math.round(document.querySelector("main")?.clientWidth || 0);
  if (!parts.length && !width) return null;
  const swatches = parts.map(([k, v]) => `${k} ${v}`).join(", ");
  return `${swatches}${width ? `; the column it sits in is ${width}px wide` : ""}`;
}

export async function snapshotDraft(
  view: AuthoredView,
  opts?: SnapshotOptions,
): Promise<Projection> {
  if (typeof document === "undefined") {
    return {
      picture: "(no page)",
      controls: [],
      actions: [],
      size: { width: 0, height: 0 },
      problems: ["looking at the table requires a browser page"],
      notes: [],
    };
  }
  return snapshotOffscreen(view, opts);
}
