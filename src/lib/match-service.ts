import type { Environment, Match, Seat, StepRecord } from "./types";
import { nid, now } from "./ids";
import {
  appendStep,
  getEnvironment,
  getMatch,
  listMatches,
  listSteps,
  putMatch,
  replaceMatchAndStep,
} from "./store";
import { trace } from "./trace";
import { withRealm } from "./sandbox";
import { validateEnv } from "./env-service";
import { fallbackView, parseRender, sanitizeView, type AuthoredView } from "./view";

function shuffle<T>(items: T[], seed: number): { items: T[]; order: number[] } {
  const idx = items.map((_, i) => i);
  let s = seed >>> 0;
  for (let i = idx.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    const t = idx[i];
    idx[i] = idx[j];
    idx[j] = t;
  }
  return { items: idx.map((i) => items[i]), order: idx };
}

function toMove(state: unknown): number {
  if (state && typeof state === "object" && "to_move" in state) {
    const n = (state as { to_move: unknown }).to_move;
    if (typeof n === "number") return n;
  }
  return 0;
}

async function requireEnv(id: string): Promise<Environment> {
  const env = await getEnvironment(id);
  if (!env) throw Object.assign(new Error("environment not found"), { status: 404 });
  return env;
}

export async function startMatch(input: {
  environment_id: string;
  seat?: number;
  agent_label?: string;
  seed?: number;
}) {
  // Every trajectory says which checks the environment passed, so make sure it
  // has been checked before anything is recorded against it.
  let env = await requireEnv(input.environment_id);
  if (!env.validation) {
    await validateEnv(env.id, 120);
    env = await requireEnv(input.environment_id);
  }
  const seed = input.seed ?? (Date.now() % 1_000_000);
  const humanSeat = input.seat ?? 0;
  const seats: Seat[] = [
    {
      seat: humanSeat,
      player_type: "human" as const,
      interface: "human_ui" as const,
    },
    {
      seat: 1 - humanSeat,
      player_type: "agent" as const,
      interface: "webmcp" as const,
      agent_label: input.agent_label,
    },
  ].sort((a, b) => a.seat - b.seat);

  const state = await withRealm(env.code, async (realm) => await realm.call("__init", { seed }));
  const match: Match = {
    id: nid("m"),
    environment_id: env.id,
    environment_revision: env.revision,
    environment_name: env.name,
    code_hash: env.code_hash,
    seed,
    state,
    revision: 1,
    terminal: false,
    rewards: [0, 0],
    to_move: toMove(state),
    seats,
    created_at: now(),
    ended_at: null,
  };
  await putMatch(match);
  trace("match_started", {
    match_id: match.id,
    environment_id: env.id,
    environment_name: env.name,
    human_seat: humanSeat,
    agent_label: input.agent_label,
    to_move: match.to_move,
  });
  const view = await observationFor(match, humanSeat);
  return { match: publicMatch(match), observation: view };
}

async function observationFor(match: Match, seat: number) {
  const env = await requireEnv(match.environment_id);
  return withRealm(env.code, async (realm) => {
    const observation = await realm.call("__observe", { state: match.state, player: seat });
    const legal = await realm.call<string[]>("__legal", { state: match.state, player: seat });
    const { items, order } = shuffle(legal, match.revision * 1009 + seat * 17);
    let view: AuthoredView;
    try {
      const rendered = await realm.call<unknown>("__render", { observation });
      const parsed = parseRender(rendered);
      view =
        parsed.kind === "html"
          ? sanitizeView(parsed.view).view
          : fallbackView(observation, legal);
    } catch {
      view = fallbackView(observation, legal);
    }
    return {
      match_id: match.id,
      seat,
      revision: match.revision,
      to_move: match.to_move,
      terminal: match.terminal,
      rewards: match.rewards,
      observation,
      legal_actions: items,
      presented_order: order,
      view,
    };
  });
}

export async function getObservation(match_id: string, seat?: number) {
  const match = await getMatch(match_id);
  if (!match) return { error: "match not found", status: 404 as const };
  const s = seat ?? match.seats.find((x) => x.player_type === "agent")?.seat ?? 1;
  const view = await observationFor(match, s);
  return view;
}

export async function takeAction(input: {
  match_id: string;
  action: string;
  expected_revision: number;
  seat?: number;
  rationale?: string;
  confidence?: number;
  interface?: Seat["interface"];
  latency_ms?: number;
}) {
  const match = await getMatch(input.match_id);
  if (!match) return { error: "match not found", status: 404 as const };
  if (match.terminal) return { error: "match is over", status: 409 as const };
  if (match.revision !== input.expected_revision) {
    return {
      error: `revision conflict: have ${match.revision}, expected ${input.expected_revision}`,
      status: 409 as const,
    };
  }
  const seat = input.seat ?? match.to_move;
  if (seat !== match.to_move) {
    return { error: `not seat ${seat}'s turn (to_move=${match.to_move})`, status: 409 as const };
  }
  const env = await requireEnv(match.environment_id);
  const started = Date.now();

  try {
    const result = await withRealm(env.code, async (realm) => {
      const observation = await realm.call("__observe", { state: match.state, player: seat });
      const legal = await realm.call<string[]>("__legal", { state: match.state, player: seat });
      if (!legal.includes(input.action)) {
        throw Object.assign(new Error(`illegal action ${input.action}`), {
          status: 400,
          legal,
        });
      }
      const { order } = shuffle(legal, match.revision * 1009 + seat * 17);
      const stepped = await realm.call<{
        state: unknown;
        rewards: number[];
        terminal: boolean;
      }>("__step", { state: match.state, action: input.action });
      return { observation, legal, order, stepped };
    });

    const next: Match = {
      ...match,
      state: result.stepped.state,
      revision: match.revision + 1,
      terminal: result.stepped.terminal,
      rewards: result.stepped.rewards,
      to_move: toMove(result.stepped.state),
      ended_at: result.stepped.terminal ? now() : null,
    };
    const steps = await listSteps(match.id);
    const record: StepRecord = {
      type: "step",
      match_id: match.id,
      index: steps.length,
      seat,
      revision: next.revision,
      observation: result.observation,
      legal_actions: result.legal,
      presented_order: result.order,
      forced: result.legal.length === 1,
      action: input.action,
      reward: result.stepped.rewards[seat] ?? 0,
      terminal: result.stepped.terminal,
      interface: input.interface ?? "webmcp",
      latency_ms: input.latency_ms ?? Date.now() - started,
      rationale: input.rationale ?? null,
      confidence: input.confidence ?? null,
    };
    await replaceMatchAndStep(next, record);
    trace("move", {
      match_id: match.id,
      seat,
      action: input.action,
      by: record.interface,
      revision: next.revision,
      terminal: next.terminal,
      rewards: next.terminal ? next.rewards : undefined,
      latency_ms: record.latency_ms,
    });
    const view = await observationFor(next, seat);
    return { match: publicMatch(next), step: record, observation: view };
  } catch (e) {
    const err = e as Error & { status?: number; legal?: string[] };
    return {
      error: err.message,
      legal_actions: err.legal,
      status: (err.status ?? 400) as 400,
    };
  }
}

export async function botMove(match_id: string) {
  const match = await getMatch(match_id);
  if (!match) return { error: "match not found", status: 404 as const };
  if (match.terminal) return { error: "match is over", status: 409 as const };
  const env = await requireEnv(match.environment_id);
  const legal = await withRealm(env.code, async (realm) =>
    await realm.call<string[]>("__legal", { state: match.state, player: match.to_move }),
  );
  if (!legal.length) return { error: "no legal actions", status: 409 as const };
  // Seeded off the match so a replay of the trajectory reproduces the bot too.
  let s = (match.seed * 2654435761 + match.revision * 40503) >>> 0;
  s = (Math.imul(s ^ (s >>> 15), 1 | s) + 1013904223) >>> 0;
  const action = legal[s % legal.length];
  return takeAction({
    match_id,
    action,
    expected_revision: match.revision,
    seat: match.to_move,
    interface: "bot",
  });
}

/**
 * The match a table should be showing. A match dealt by the agent and a match
 * dealt by the person are the same thing, so the board finds it either way —
 * including after a reload, which used to drop it.
 */
export async function liveMatch(environmentId?: string) {
  const all = await listMatches(environmentId);
  // A table asks about its own game and wants the last one either way, so a
  // finished board survives a reload. The gallery asks about all of them and
  // only cares about a game still waiting for someone.
  const match = all.find((m) => !m.terminal) ?? (environmentId ? all[0] : null) ?? null;
  return { match: match ? publicMatch(match) : null };
}

export async function waitForTurn(input: {
  match_id: string;
  after_revision: number;
  seat?: number;
  timeout_ms?: number;
}) {
  const timeout = Math.min(Math.max(input.timeout_ms ?? 8000, 250), 8000);
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const match = await getMatch(input.match_id);
    if (!match) return { error: "match not found", status: 404 as const };
    // What the caller is waiting for is its own turn, which may already have
    // arrived. Waiting on a revision bump instead deadlocks a caller that asks
    // while the board is already its own — nobody else is going to move.
    const yours = input.seat != null && match.to_move === input.seat;
    const advanced = input.seat == null && match.revision > input.after_revision;
    if (yours || advanced || match.terminal) {
      const seat = input.seat ?? match.to_move;
      const view = await observationFor(match, seat);
      return { status: "ready" as const, match: publicMatch(match), observation: view };
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return { status: "still_waiting" as const, after_revision: input.after_revision };
}

export async function exportEpisodes(input: { environment_id?: string; match_id?: string }) {
  const matches = input.match_id
    ? [await getMatch(input.match_id)].filter((m): m is Match => !!m)
    : await listMatches(input.environment_id);
  const lines: unknown[] = [];
  for (const match of matches) {
    const steps = await listSteps(match.id);
    const env = await getEnvironment(match.environment_id);
    lines.push({
      type: "episode",
      schema_version: "arena-1",
      match_id: match.id,
      environment: {
        id: match.environment_id,
        revision: match.environment_revision,
        name: match.environment_name,
        code_hash: match.code_hash,
        validation: env?.validation?.ok ? "pass" : env?.validation ? "fail" : "unknown",
      },
      seed: match.seed,
      seats: match.seats,
      returns: match.rewards,
      length: steps.length,
    });
    for (const s of steps) lines.push(s);
  }
  return {
    count: matches.length,
    jsonl: lines.map((l) => JSON.stringify(l)).join("\n"),
    records: lines,
  };
}

export function publicMatch(match: Match) {
  return {
    id: match.id,
    environment_id: match.environment_id,
    environment_name: match.environment_name,
    revision: match.revision,
    seed: match.seed,
    terminal: match.terminal,
    rewards: match.rewards,
    to_move: match.to_move,
    seats: match.seats,
    code_hash: match.code_hash,
  };
}

export { observationFor, appendStep };
