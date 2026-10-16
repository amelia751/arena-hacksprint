"use client";

import { useEffect, useRef } from "react";
import type { AuthoredView } from "@/lib/view";
import { mountView, type ViewHandle } from "@/lib/view-frame";
import { registerLiveTable } from "@/lib/view-dom";

const EMPTY: AuthoredView = { html: "", css: "" };

export function GameView({
  view,
  legal,
  disabled,
  environmentId,
  matchId,
  moved,
  onAction,
  live = true,
}: {
  view: AuthoredView;
  legal: string[];
  disabled?: boolean;
  environmentId: string;
  matchId: string | null;
  moved?: boolean;
  onAction?: (id: string) => void;
  /** Only the board someone is actually playing answers inspect_view. */
  live?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<ViewHandle | null>(null);
  const actionRef = useRef(onAction);
  const legalRef = useRef(legal);
  const variedRef = useRef(false);
  const legalKey = legal.join("|");

  useEffect(() => {
    actionRef.current = onAction;
  }, [onAction]);

  // One frame per environment; every later change goes through update().
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const h = mountView(el, EMPTY, { onAction: (id) => actionRef.current?.(id) });
    handle.current = h;
    return () => {
      handle.current = null;
      h.destroy();
    };
  }, [environmentId]);

  useEffect(() => {
    handle.current?.update(view);
  }, [view]);

  useEffect(() => {
    legalRef.current = legal;
    variedRef.current = !!moved;
    handle.current?.setLegal(legal, !!disabled);
  }, [legal, legalKey, disabled, moved, view]);

  useEffect(() => {
    if (!live) return;
    registerLiveTable({
      environment_id: environmentId,
      match_id: matchId,
      snapshot: async (opts) =>
        (await handle.current?.snapshot(opts)) ?? {
          picture: "(the table is not mounted)",
          controls: [],
          actions: [],
          size: { width: 0, height: 0 },
          problems: ["no table is mounted on the page"],
          notes: [],
        },
      legal: () => legalRef.current,
      varied: () => variedRef.current,
    });
    return () => registerLiveTable(null);
  }, [environmentId, matchId, live]);

  return <div ref={host} className="game-host" />;
}
