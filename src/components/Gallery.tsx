"use client";

import { useCallback, useEffect, useState } from "react";
import { EnvCard } from "./EnvCard";
import { registerLive } from "@/lib/live";

type Card = { id: string; name: string; description: string; published?: boolean };
type Dealt = { id: string; environment_id: string; environment_name: string } | null;

async function loadDealt(): Promise<Dealt> {
  try {
    const res = await fetch("/api/matches", { cache: "no-store" });
    const body = (await res.json()) as { match?: Dealt };
    return body.match ?? null;
  } catch {
    return null;
  }
}

async function loadCards(): Promise<Card[]> {
  const res = await fetch("/api/environments", { cache: "no-store" });
  const body = (await res.json()) as { environments?: Card[] };
  return body.environments ?? [];
}

function BlankCard() {
  return (
    <article className="game-card game-card-blank" aria-hidden="true">
      <div className="game-card-top">
        <svg
          className="env-icon"
          viewBox="0 0 48 48"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        >
          <rect x="10" y="10" width="28" height="28" rx="6" />
        </svg>
      </div>
      <div className="game-card-body" />
    </article>
  );
}

export function Gallery() {
  const [games, setGames] = useState<Card[] | null>(null);
  const [dealt, setDealt] = useState<Dealt>(null);

  const reload = useCallback(async () => {
    setGames(await loadCards());
    setDealt(await loadDealt());
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  }, []);

  useEffect(() => registerLive(reload), [reload]);

  useEffect(() => {
    let stale = false;
    const draw = async () => {
      const [next, live] = await Promise.all([loadCards(), loadDealt()]);
      if (stale) return;
      setGames(next);
      setDealt(live);
    };
    // A shelf nobody is looking at does not need asking every two seconds, and
    // a tab left open all day is load the store has to answer for no reason.
    let tick: ReturnType<typeof setInterval>;
    const arm = () => {
      clearInterval(tick);
      tick = setInterval(() => void draw(), document.hidden ? 15000 : 2000);
    };
    const onVis = () => {
      if (!document.hidden) void draw();
      arm();
    };
    void draw();
    arm();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stale = true;
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  if (games === null) {
    return (
      <section className="gallery">
        <ul className="card-grid">
          <li>
            <BlankCard />
          </li>
        </ul>
      </section>
    );
  }

  if (games.length === 0) {
    return (
      <section className="gallery">
        <p className="blank-line">Nothing here yet.</p>
        <ul className="card-grid">
          <li>
            <BlankCard />
          </li>
        </ul>
      </section>
    );
  }

  const published = games.filter((env) => env.published);
  const drafts = games.filter((env) => !env.published);

  return (
    <section className="gallery">
      {/* The agent can deal a match from anywhere. This is how the person finds it. */}
      {dealt ? (
        <a className="dealt" href={`/e/${dealt.environment_id}`}>
          <span>A match is dealt on {dealt.environment_name} and waiting for you</span>
          <span className="dealt-go">Sit down</span>
        </a>
      ) : null}
      <Shelf label="Published" games={published} />
      <Shelf label="Drafts" games={drafts} />
    </section>
  );
}

function Shelf({ label, games }: { label: string; games: Card[] }) {
  if (games.length === 0) return null;
  return (
    <>
      <p className="section-label">{label}</p>
      <ul className="card-grid">
        {games.map((env) => (
          <li key={env.id}>
            <EnvCard env={env} />
          </li>
        ))}
      </ul>
    </>
  );
}
