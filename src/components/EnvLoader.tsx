"use client";

import { useEffect, useState } from "react";
import { EnvChrome } from "./EnvChrome";
import { PlayDesk } from "./PlayDesk";
import { InspectDesk } from "./InspectDesk";
import { DataPanel } from "./DataPanel";
import { RevalidateButton } from "./RevalidateButton";
import type { EnvTab } from "./EnvTabs";
import type { Environment } from "@/lib/types";
import { registerLive } from "@/lib/live";

/**
 * Null means this game is genuinely not here. Anything else — the store not
 * answering, a bad connection — throws, because saying "not here" about a game
 * that exists is worse than waiting a moment longer.
 */
async function loadEnv(id: string): Promise<Environment | null> {
  const res = await fetch(`/api/environments/${id}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`the store did not answer (${res.status})`);
  const body = (await res.json()) as Environment & { error?: string };
  if (!body.id) throw new Error(body.error || "no game came back");
  return body;
}

function useEnv(id: string) {
  const [env, setEnv] = useState<Environment | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let stale = false;
    let retry: ReturnType<typeof setTimeout>;
    const draw = async () => {
      try {
        const next = await loadEnv(id);
        if (stale) return;
        if (!next) {
          setMissing(true);
          return;
        }
        setMissing(false);
        setEnv(next);
      } catch {
        // The store went quiet. Keep whatever is on screen — an empty table is
        // better than a wrong answer — and come back for it shortly.
        if (!stale) retry = setTimeout(() => void draw(), 1500);
      }
    };
    const stop = registerLive(draw);
    void draw();
    return () => {
      stale = true;
      clearTimeout(retry);
      stop();
    };
  }, [id]);

  return { env, missing };
}

function Shell({
  id,
  tab,
  children,
}: {
  id: string;
  tab: EnvTab;
  children: (env: Environment) => React.ReactNode;
}) {
  const { env, missing } = useEnv(id);
  if (missing) {
    return (
      <main>
        <p className="note">That game is not here.</p>
      </main>
    );
  }
  if (!env) {
    return (
      <main>
        <p className="note">Loading…</p>
      </main>
    );
  }
  return <EnvChrome env={env} current={tab}>{children(env)}</EnvChrome>;
}

export function EnvPlay({ id }: { id: string }) {
  return (
    <Shell id={id} tab="play">
      {(env) => (
        <>
          <PlayDesk environmentId={env.id} />
          <p className="note">
            Every move is written to a trajectory. Ask the agent for export_episodes, or download
            the tape under the board.
          </p>
        </>
      )}
    </Shell>
  );
}

export function EnvInspect({ id }: { id: string }) {
  return (
    <Shell id={id} tab="inspect">
      {(env) => (
        <>
          <p className="note">
            Walk the game without playing it. Switch players at the same position to see exactly
            what each side is told — in a game with hidden cards, the two views should not match.
          </p>
          <InspectDesk environmentId={env.id} code={env.code} />
        </>
      )}
    </Shell>
  );
}

export function EnvData({ id }: { id: string }) {
  return (
    <Shell id={id} tab="data">
      {(env) => (
        <>
          <div className="data-bar">
            <p className="note">
              What a match on this table writes down, and what each player is allowed to know.
            </p>
            <RevalidateButton id={env.id} />
          </div>
          <div className="report">
            <DataPanel
              environmentId={env.id}
              revision={env.revision}
              report={env.validation}
              players={env.players}
            />
          </div>
        </>
      )}
    </Shell>
  );
}
