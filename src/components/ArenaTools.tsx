"use client";

import { useCallback, useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { snapshotDraft, snapshotLiveTable, surroundings } from "@/lib/view-dom";
import type { Projection } from "@/lib/view-project";
import {
  currentDesk,
  openEnvironment,
  refreshView,
  registerNavigator,
  registerRefresher,
  waitForDesk,
} from "@/lib/session";
import { beginAgentRun, endAgentRun } from "@/lib/agent-run";
import { withHandOver } from "@/lib/hand-over";

/**
 * What the browser hands execute(): an abort signal that fires if the call is
 * cancelled, and — where the browser implements it — a way to hand control back
 * to the person for the length of an inner promise.
 */
type ToolRun = {
  signal?: AbortSignal;
  requestUserInteraction?: (fn: () => Promise<unknown>) => Promise<unknown>;
};

/** Short enough to read a whole session at a glance, long enough to place it. */
function brief(input: unknown): string {
  if (input == null || typeof input !== "object") return String(input ?? "");
  const parts: string[] = [];
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (v == null) continue;
    if (typeof v === "object") {
      parts.push(`${k}=${Array.isArray(v) ? `[${v.length}]` : `{${Object.keys(v).join(",")}}`}`);
    } else {
      const s = String(v);
      parts.push(`${k}=${s.length > 40 ? `${s.slice(0, 40)}…` : s}`);
    }
  }
  return parts.join(" ").slice(0, 300);
}

/**
 * Most of this runs in a browser we cannot open. Reporting each call means a
 * session can be read back later instead of described from memory.
 */
function report(fields: Record<string, unknown>) {
  try {
    void fetch("/api/trace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(fields),
    }).then(
      (r) => r.body?.cancel(),
      () => undefined,
    );
  } catch {
    /* diagnostics must never break a tool call */
  }
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: text || res.statusText, status: res.status };
  }
}

/** Calls that store something repaint the person's page before the agent hears back. */
async function writeApi(path: string, init?: RequestInit) {
  const res = await api(path, init);
  await refreshView();
  return res;
}

/** Tools return enough for the agent to pick its own next move. */
function nextStep(state: {
  terminal?: boolean;
  your_turn?: boolean;
  rewards?: number[];
  seat?: number;
}): string {
  if (state.terminal) {
    const mine = state.rewards && state.seat != null ? state.rewards[state.seat] : undefined;
    const verdict = mine == null ? "" : mine > 0 ? " You won." : mine < 0 ? " You lost." : " A draw.";
    return `The game is over.${verdict} export_episodes shows what was recorded.`;
  }
  if (state.your_turn) {
    return "It is your move. Choose from legal_actions and call take_action with the revision above, or call inspect_view first to see the board as a picture.";
  }
  return "It is their move. Call wait_for_turn now — it blocks until they play and hands you the new position.";
}

/**
 * Shortens the long strings and long lists inside a value. Ids, names and hashes
 * are short and are the whole point of the answer, so nothing below the floor is
 * ever touched however tight the budget gets.
 */
const KEEP_WHOLE = 64;
function prune(value: unknown, budget: number, cap: number): unknown {
  if (typeof value === "string") {
    const limit = Math.max(budget, KEEP_WHOLE);
    return value.length <= limit ? value : value.slice(0, limit) + "…";
  }
  if (Array.isArray(value)) {
    const kept = value.slice(0, cap).map((v) => prune(v, budget, cap));
    return value.length > cap ? kept.concat([`… ${value.length - cap} more`]) : kept;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = prune(v, budget, cap);
    return out;
  }
  return value;
}

const size = (v: unknown) => (JSON.stringify(v) ?? "").length;

/**
 * Cutting a JSON string in half leaves something that will not parse, and the id
 * an agent needs is usually past the cut. Prose can be sliced; a value gets shrunk
 * — shorter strings, then shorter lists, then whole fields dropped — so whatever
 * comes back is still JSON.
 */
function clip(value: unknown, max = 1800): string {
  if (typeof value === "string") {
    return value.length <= max ? value : value.slice(0, max - 24) + "… [truncated]";
  }
  if (size(value) <= max) return JSON.stringify(value) ?? "";
  for (const [budget, cap] of [
    [600, 40],
    [200, 12],
    [0, 4],
  ]) {
    const shrunk = prune(value, budget, cap);
    if (size(shrunk) <= max) return JSON.stringify(shrunk) ?? "";
  }
  // Still over budget because of its shape, so shed the biggest fields.
  const small = prune(value, 0, 4);
  if (small && typeof small === "object" && !Array.isArray(small)) {
    const rec = small as Record<string, unknown>;
    const dropped: string[] = [];
    const heaviest = Object.keys(rec).sort((a, b) => size(rec[b]) - size(rec[a]));
    for (const k of heaviest) {
      if (size(rec) + size(dropped) + 20 <= max) break;
      delete rec[k];
      dropped.push(k);
    }
    if (dropped.length) rec.dropped_fields = dropped;
    if (size(rec) <= max) return JSON.stringify(rec) ?? "";
  }
  return JSON.stringify({ error: "the answer was too large to show" });
}

/** The agent wrote the code, so echoing it back only crowds out the report. */
function withoutCode(res: unknown): unknown {
  if (!res || typeof res !== "object") return res;
  const rec = res as Record<string, unknown>;
  const env = rec.environment;
  if (!env || typeof env !== "object") return res;
  const rest = { ...(env as Record<string, unknown>) };
  delete rest.code;
  return { ...rec, environment: rest };
}

/** The view tools answer in prose, not JSON: the agent is reading a picture. */
function renderProjection(
  snap: Projection,
  extra?: { legal?: string[] | null; where?: string },
): string {
  const out: string[] = [];
  out.push(snap.problems.length ? "ok: false" : "ok: true");
  if (extra?.where) out.push(`showing: ${extra.where}`);
  out.push(`size: ${snap.size.width}x${snap.size.height}px`);
  const host = surroundings();
  if (host) out.push(`the page around it: ${host}`);
  out.push("");
  out.push("what painted:");
  out.push(snap.picture);
  out.push("");
  if (snap.controls.length) {
    const enabled = snap.controls.filter((c) => c.enabled).length;
    out.push(
      `controls (${snap.controls.length}, ${enabled} enabled): ` +
        snap.controls
          .slice(0, 16)
          .map((c) => `${c.action}${c.enabled ? "" : "*"}`)
          .join(" ") +
        (snap.controls.length > 16 ? " …" : ""),
    );
  } else {
    out.push("controls: none");
  }
  if (extra?.legal?.length) out.push(`legal now: ${extra.legal.join(" ")}`);
  if (snap.problems.length) {
    out.push("");
    out.push("problems — the table does not work until these are fixed:");
    for (const w of snap.problems) out.push(`  - ${w}`);
  }
  if (snap.notes.length) {
    out.push("");
    out.push("notes — cosmetic, fix if you can but they do not block play:");
    for (const w of snap.notes) out.push(`  - ${w}`);
  }
  if (!snap.problems.length) {
    out.push("");
    out.push("The table works. Move on when you are happy with how it looks.");
  }
  return out.join("\n");
}

const GUIDE_DESC =
  "The five-function contract, the sandbox rules, how to write render() as HTML+CSS, and the look-and-fix loop with preview_view. Call this before writing any code.";

export function ArenaTools() {
  const router = useRouter();
  const [repainting, startRepaint] = useTransition();
  const repaintWaiters = useRef<Array<() => void>>([]);

  useEffect(() => {
    if (repainting || !repaintWaiters.current.length) return;
    const done = repaintWaiters.current;
    repaintWaiters.current = [];
    for (const resolve of done) resolve();
  }, [repainting]);

  // Resolves on the edge where the refresh transition settles, so the tool answers
  // against markup that has already painted rather than the markup it replaced.
  const repaint = useCallback(
    () =>
      new Promise<void>((resolve) => {
        const give_up = setTimeout(resolve, 2000);
        repaintWaiters.current.push(() => {
          clearTimeout(give_up);
          resolve();
        });
        startRepaint(() => router.refresh());
      }),
    [router],
  );

  useEffect(() => {
    registerNavigator((path) => router.push(path));
    registerRefresher(repaint);
    return () => {
      registerNavigator(null);
      registerRefresher(null);
    };
  }, [router, repaint]);

  useEffect(() => {
    const model = document.modelContext ?? navigator.modelContext;
    if (!model?.registerTool) return;
    const controller = new AbortController();
    const { signal } = controller;

    const deskMatch = () => currentDesk()?.match() ?? null;

    /**
     * When the agent was last handed a position. take_action reports the gap, so
     * latency_ms on a row means the same thing whoever moved — how long the
     * player took to decide — instead of how long the sandbox took to run.
     */
    let handed = 0;
    const handOver = () => {
      handed = Date.now();
    };
    const decided = () => (handed ? Date.now() - handed : undefined);

    /**
     * The match on screen, or the one still running on the server when this page
     * has no table mounted — which is what happens the moment a browser reloads
     * or navigates between turns. Losing the match there used to end the game.
     */
    const currentMatch = async (matchId?: string) => {
      const here = deskMatch();
      if (here && (!matchId || here.match_id === matchId)) return here;
      const res = matchId
        ? await api(`/api/matches/${matchId}`)
        : await api("/api/matches");
      const m = res?.match;
      if (!m?.id) return null;
      const seats: Array<{ seat: number; player_type: string }> = m.seats ?? [];
      const agent_seat = seats.find((s) => s.player_type === "agent")?.seat ?? 1;
      const human_seat = seats.find((s) => s.player_type === "human")?.seat ?? 1 - agent_seat;
      return {
        match_id: m.id,
        environment_id: m.environment_id,
        environment_name: m.environment_name,
        human_seat,
        agent_seat,
        revision: m.revision,
        to_move: m.to_move,
        terminal: m.terminal,
        rewards: m.rewards,
      };
    };

    /**
     * Sit inside the call until the board is the agent's again.
     *
     * The server can only hold a request for a few seconds before the platform
     * cuts it, so the waiting happens here: short server waits stitched together
     * with the promise left pending across all of them.
     */
    const holdForTurn = async (opts: {
      id: string;
      seat?: number;
      afterRevision: number;
      run?: ToolRun;
      budgetMs?: number;
    }) => {
      const q = new URLSearchParams({ after_revision: String(opts.afterRevision) });
      if (opts.seat != null) q.set("seat", String(opts.seat));
      const budget = Math.min(Math.max(opts.budgetMs ?? 50000, 1000), 110000);
      const until = Date.now() + budget;
      const loop = async () => {
        let last = null;
        while (Date.now() < until) {
          if (opts.run?.signal?.aborted) return null;
          const slice = Math.min(8000, Math.max(1000, until - Date.now()));
          last = await api(`/api/matches/${opts.id}/wait?${q}&timeout_ms=${slice}`, {
            signal: opts.run?.signal,
          });
          if (last?.error || last?.status === "ready") return last;
        }
        return last;
      };
      // Handing control to the person is exactly what this is, so say so when
      // the browser offers a way to say it.
      const res = await withHandOver(opts.run, loop);
      return { res, budget };
    };

    /**
     * Turn a position into an answer — and while it is still the person's move,
     * keep the call open rather than answering.
     *
     * An assistant only runs while it is replying. The moment a play tool hands
     * back a "your move" and the assistant says something friendly, the game is
     * over for it: nothing on this page can reach it again until the person
     * types. So a tool that would return "waiting on them" waits instead.
     */
    const settle = async (opts: {
      id: string;
      seat?: number;
      run?: ToolRun;
      observation: {
        revision?: number;
        to_move?: number;
        terminal?: boolean;
        rewards?: number[];
        observation?: unknown;
        legal_actions?: string[];
      };
      prefix?: string;
    }) => {
      let o = opts.observation;
      let held = 0;
      // Waiting on somebody whose board is not on screen is waiting for a click
      // that cannot happen. Give the table a moment to mount, then say so.
      const atTable = () => currentDesk()?.match()?.match_id === opts.id;
      let reachable = true;
      if (!o?.terminal && o?.to_move !== opts.seat) {
        reachable = atTable();
        const { res, budget } = await holdForTurn({
          id: opts.id,
          seat: opts.seat,
          afterRevision: Number(o?.revision ?? 0),
          run: opts.run,
          budgetMs: reachable ? undefined : 8000,
        });
        held = budget;
        if (res?.error) return `${opts.prefix ?? ""}${clip(res)}`;
        if (res?.status === "ready" && res.observation) o = res.observation;
      }
      await currentDesk()?.refresh();
      handOver();
      const yourTurn = o?.to_move === opts.seat;
      if (!o?.terminal && !yourTurn) {
        if (!reachable && !atTable()) {
          return `${opts.prefix ?? ""}It is their move, but this match is not on their screen, so there is no board for them to click. Ask them to open the table, then call wait_for_turn.`;
        }
        return `${opts.prefix ?? ""}still_waiting — they have not moved in ${Math.round(
          held / 1000,
        )}s (revision ${o?.revision}). Call wait_for_turn to keep holding. If you would rather stop, tell them the board is waiting on them and that a message brings you back.`;
      }
      return `${opts.prefix ?? ""}${clip(
        {
          revision: o?.revision,
          to_move: o?.to_move,
          your_turn: yourTurn,
          terminal: o?.terminal,
          rewards: o?.rewards,
          observation: o?.observation,
          legal_actions: o?.legal_actions,
        },
        2000,
      )}\n${nextStep({
        terminal: o?.terminal,
        your_turn: yourTurn,
        rewards: o?.rewards,
        seat: opts.seat,
      })}`;
    };

    // Publishing is the claim that the table is good, and you cannot make that
    // claim about markup you never looked at. Records the revision last seen.
    const looked = new Map<string, number>();

    const tools: Array<{
      name: string;
      title: string;
      description: string;
      inputSchema: Record<string, unknown>;
      annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
      execute: (input: Record<string, unknown>, ctx: ToolRun) => Promise<string>;
    }> = [
      {
        name: "get_authoring_guide",
        title: "Read the authoring guide",
        description: GUIDE_DESC,
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true },
        execute: async (_input, { signal }) => {
          const res = await api("/api/guide", { signal });
          return typeof res.guide === "string" ? res.guide : clip(res, 9000);
        },
      },
      {
        name: "list_environments",
        title: "List the games on this page",
        description:
          "List the environments that exist on this page, with their validation state and whether each is published.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: async (_input, { signal }) => clip(await api("/api/environments", { signal })),
      },
      {
        name: "get_environment",
        title: "Read a game's source",
        description:
          "Read one environment. Pass fn to fetch a single function body (init, legal_actions, observe, step, render) instead of all five.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "The environment id, as list_environments reports it." },
            fn: {
              type: "string",
              enum: ["init", "legal_actions", "observe", "step", "render"],
              description: "One function to read on its own, which keeps a long game readable.",
            },
          },
          required: ["id"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: async ({ id, fn }, { signal }) => {
          const q = fn ? `?fn=${encodeURIComponent(String(fn))}` : "";
          return clip(await api(`/api/environments/${id}${q}`, { signal }), 4000);
        },
      },
      {
        name: "create_environment",
        title: "Create a new game",
        description:
          "Create an environment. code may be partial — send the functions you have and build up. Validation runs immediately and comes back with the result.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "What the game is called, as a person would say it." },
            description: { type: "string", description: "One line on what playing it is like." },
            players: { type: "integer", description: "How many seats. Default 2." },
            code: {
              type: "object",
              description: "Whole function declarations as source text, each named for the function it defines.",
              properties: {
                init: { type: "string", description: "init(seed) -> state, including a numeric to_move." },
                legal_actions: { type: "string", description: "legal_actions(state, player) -> array of action id strings." },
                observe: { type: "string", description: "observe(state, player) -> only what that seat may know." },
                step: { type: "string", description: "step(state, action) -> { state, rewards, terminal }." },
                render: { type: "string", description: "render(observation) -> { html, css } for the table." },
              },
            },
          },
          required: ["name"],
          additionalProperties: false,
        },
        annotations: { untrustedContentHint: true },
        execute: async (input, { signal }) =>
          clip(
            withoutCode(
              await writeApi("/api/environments", {
                method: "POST",
                body: JSON.stringify(input),
                signal,
              }),
            ),
            3500,
          ),
      },
      {
        name: "fork_environment",
        title: "Copy a game into a new draft",
        description:
          "Copy an environment into a new draft you can edit — the way to revise something already published, since publishing freezes it.",
        inputSchema: {
          type: "object",
          properties: {
            source_id: { type: "string", description: "The environment to copy from." },
            name: { type: "string", description: "What to call the copy." },
          },
          required: ["source_id", "name"],
          additionalProperties: false,
        },
        annotations: { untrustedContentHint: true },
        execute: async ({ source_id, name }, { signal }) =>
          clip(
            withoutCode(
              await writeApi(`/api/environments/${source_id}/fork`, {
                method: "POST",
                body: JSON.stringify({ name }),
                signal,
              }),
            ),
            2500,
          ),
      },
      {
        name: "update_environment",
        title: "Revise a draft",
        description:
          "Patch one or more functions on a draft and re-run validation. Takes expected_revision from the last create or update. A published environment is frozen, so fork it to change it.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "The draft to patch." },
            expected_revision: {
              type: "integer",
              description: "The revision your last call returned. Guards against writing over a change you have not seen.",
            },
            name: { type: "string", description: "A new name, if you are renaming it." },
            description: { type: "string", description: "A new one-line description." },
            code: {
              type: "object",
              description: "Only the functions you are replacing. The rest are left alone.",
              properties: {
                init: { type: "string", description: "init(seed) -> state, including a numeric to_move." },
                legal_actions: { type: "string", description: "legal_actions(state, player) -> array of action id strings." },
                observe: { type: "string", description: "observe(state, player) -> only what that seat may know." },
                step: { type: "string", description: "step(state, action) -> { state, rewards, terminal }." },
                render: { type: "string", description: "render(observation) -> { html, css } for the table." },
              },
            },
          },
          required: ["id", "expected_revision"],
          additionalProperties: false,
        },
        annotations: { untrustedContentHint: true },
        execute: async ({ id, ...rest }, { signal }) =>
          clip(
            withoutCode(
              await writeApi(`/api/environments/${id}`, {
                method: "PATCH",
                body: JSON.stringify(rest),
                signal,
              }),
            ),
            3500,
          ),
      },
      {
        name: "validate_environment",
        title: "Run the checks on a game",
        description:
          "Run every check — it runs, it replays, it rejects illegal moves, it ends, it keeps each seat's cards to itself, and render paints the observation. Failures come back as repair instructions with the seed that produced them.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "The environment to check." },
            episodes: {
              type: "integer",
              description: "Random playouts to run. Default 300. More episodes catch rarer positions.",
            },
          },
          required: ["id"],
          additionalProperties: false,
        },
        annotations: { untrustedContentHint: true },
        execute: async ({ id, episodes }, { signal }) =>
          clip(
            withoutCode(
              await writeApi(`/api/environments/${id}/validate`, {
                method: "POST",
                body: JSON.stringify({ episodes }),
                signal,
              }),
            ),
            3500,
          ),
      },
      {
        name: "trace_episode",
        title: "Step through a game move by move",
        description:
          "Step through your game one move at a time and see what each function saw: the state, the legal actions, the observation, the action applied, and the rewards. Pass actions to drive it down a specific line, or leave it out to let it play itself. This is how you find out why a playout failed.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "The environment to walk through." },
            seed: { type: "integer", description: "Which deal to walk. Quote the seed a failure reported." },
            actions: {
              type: "array",
              items: { type: "string" },
              description: "Play these in order, then continue at random. Reproduces a specific line.",
            },
            max_steps: { type: "integer", description: "How many moves to walk. Default 12." },
          },
          required: ["id"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: async ({ id, ...rest }, { signal }) => {
          const res = await api(`/api/environments/${id}/trace`, {
            method: "POST",
            body: JSON.stringify(rest),
            signal,
          });
          if (res.error) return clip(res);
          const rows: Array<Record<string, unknown>> = res.rows ?? [];
          if (!rows.length) return `Nothing ran. ${res.stopped ?? ""}`.trim();
          const out: string[] = [`seed ${res.seed} — ${rows.length} move(s), then: ${res.stopped}`, ""];
          for (const r of rows) {
            out.push(`step ${r.n} · seat ${r.seat}`);
            out.push(`  state: ${r.state}`);
            if (Array.isArray(r.legal)) out.push(`  legal: ${r.legal.join(" ") || "(none)"}`);
            if (r.observation !== undefined) out.push(`  observe: ${r.observation}`);
            if (r.action !== undefined) out.push(`  played: ${r.action}`);
            if (r.rewards !== undefined) out.push(`  rewards: ${JSON.stringify(r.rewards)}${r.terminal ? " (ended)" : ""}`);
            if (r.error) out.push(`  BROKE HERE: ${r.error}`);
          }
          if (res.final) out.push("", `final state: ${res.final}`);
          return clip(out.join("\n"), 4000);
        },
      },
      {
        name: "preview_view",
        title: "Look at a table",
        description:
          "Look at the table. Mounts markup and describes what actually painted — the board as a character grid with real colours, every control and its size, and any layout problem. Pass html+css to try a draft, or environment_id to see the saved render(). Call this after every markup change.",
        inputSchema: {
          type: "object",
          properties: {
            html: { type: "string", description: "Draft markup. Clickable nodes need data-action." },
            css: { type: "string", description: "Draft stylesheet. Styles are inline-only; url() and @import are stripped." },
            environment_id: { type: "string", description: "Run this environment's saved render()." },
            seed: { type: "integer", description: "Which deal to draw. Different seeds deal different cards." },
            moves: {
              type: "array",
              items: { type: "string" },
              description: "Actions to play first, so you can see a board mid-game rather than empty.",
            },
            seat: { type: "integer", description: "Whose view to render. Default the seat to move." },
          },
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: async ({ html, css, environment_id, seed, moves, seat }, { signal }) => {
          let view = {
            html: typeof html === "string" ? html : "",
            css: typeof css === "string" ? css : "",
          };
          let legal: string[] | undefined;
          let where = "draft markup";
          if (environment_id && !view.html) {
            const q = new URLSearchParams();
            if (seed != null) q.set("seed", String(seed));
            if (seat != null) q.set("seat", String(seat));
            if (Array.isArray(moves) && moves.length) q.set("moves", moves.join(","));
            const res = await api(`/api/environments/${environment_id}/view?${q}`, { signal });
            if (res.error) return clip(res);
            if (res.view && typeof res.revision === "number") {
              looked.set(String(environment_id), res.revision);
            }
            if (res.view) view = res.view;
            legal = res.legal_actions;
            where = `${environment_id} render() at seat ${res.seat}${
              Array.isArray(moves) && moves.length ? ` after ${moves.join(", ")}` : ""
            }`;
            if (!view.html) return clip(res, 2500);
          }
          if (!view.html) {
            return "Pass html (with css), or environment_id to render a saved environment. Clickable elements need data-action matching a legal action id.";
          }
          const playedMoves = Array.isArray(moves) ? moves.length : 0;
          const snap = await snapshotDraft(view, { legal, varied: playedMoves > 0 });
          return clip(renderProjection(snap, { legal, where }), 2600);
        },
      },
      {
        name: "inspect_view",
        title: "Look at the live table",
        description:
          "Look at the live table the person is playing on right now — same description as preview_view, but of the real board rather than a draft. Use it to check the board matches the position after a move.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: async () => {
          const snap = await snapshotLiveTable();
          if (!snap) {
            return "No table is on screen. Call open_environment or start_match first, or use preview_view to look at a draft.";
          }
          return clip(
            renderProjection(snap, {
              where: `live table for ${snap.environment_id}${snap.match_id ? ` (match ${snap.match_id})` : ""}`,
            }),
            2600,
          );
        },
      },
      {
        name: "describe_dataset",
        title: "Describe the data a game records",
        description:
          "The trajectory schema for this environment — observation fields, action space, reward range — plus one real sample row from a playout.",
        inputSchema: {
          type: "object",
          properties: { id: { type: "string", description: "The environment to describe." } },
          required: ["id"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: async ({ id }, { signal }) =>
          clip(await api(`/api/environments/${id}/dataset`, { signal }), 2500),
      },
      {
        name: "publish_environment",
        title: "Publish a game",
        description:
          "Publish a revision you have looked at with preview_view and every check passes on, which mints its shareable page and freezes the code.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "The environment to publish." },
            expected_revision: {
              type: "integer",
              description: "The revision to publish, which is the one you last previewed.",
            },
            confirm_info_flow: {
              type: "boolean",
              description: "Confirm the information-flow matrix reads correctly for this game.",
            },
          },
          required: ["id", "expected_revision"],
          additionalProperties: false,
        },
        annotations: { untrustedContentHint: true },
        execute: async ({ id, ...rest }, { signal }) => {
          const seen = looked.get(String(id));
          if (seen !== rest.expected_revision) {
            return `Publish blocked — you have not looked at revision ${rest.expected_revision} of ${id}. Call preview_view({ environment_id: "${id}", moves: [...] }) and read the picture it returns${
              seen == null ? "" : ` (you last looked at revision ${seen})`
            }. A table nobody has looked at is not ready to publish.`;
          }
          return clip(
            withoutCode(
              await writeApi(`/api/environments/${id}/publish`, {
                method: "POST",
                body: JSON.stringify(rest),
                signal,
              }),
            ),
            2500,
          );
        },
      },
      {
        name: "open_environment",
        title: "Put a game on the person's screen",
        description:
          "Put an environment's table on the person's screen and describe what they can now see. Do this before starting a match so you are both looking at the same board.",
        inputSchema: {
          type: "object",
          properties: { id: { type: "string", description: "The environment to open." } },
          required: ["id"],
          additionalProperties: false,
        },
        annotations: { untrustedContentHint: true },
        execute: async ({ id }) => {
          const desk = await openEnvironment(String(id));
          if (!desk) return `Opened /e/${id}, but its table has not mounted yet. Call inspect_view in a moment.`;
          const snap = await snapshotLiveTable();
          const head = `Opened /e/${id} on the person's screen.`;
          if (!snap) return `${head} No board is dealt yet — call start_match to deal one.`;
          return clip(`${head}\n\n${renderProjection(snap, { where: `live table for ${id}` })}`, 2600);
        },
      },
      {
        name: "start_match",
        title: "Deal a match against the person",
        description:
          "Deal a match on the person's screen and take a seat opposite them. If they move first, this stays open through their opening move and returns the position with you to play, so answer it with a move. Joins a match already on the table rather than dealing a second one.",
        inputSchema: {
          type: "object",
          properties: {
            environment_id: { type: "string", description: "The published game to deal." },
            human_seat: { type: "integer", description: "Seat the person plays. Default 0." },
            agent_label: { type: "string", description: "How you want to be named in the dataset." },
          },
          required: ["environment_id"],
          additionalProperties: false,
        },
        annotations: { untrustedContentHint: true },
        execute: async ({ environment_id, human_seat, agent_label }, run) => {
          const desk = await openEnvironment(String(environment_id));
          if (!desk) {
            const res = await api("/api/matches", {
              method: "POST",
              body: JSON.stringify({ environment_id, seat: human_seat ?? 0, agent_label }),
            });
            return `${clip(res, 1800)}\nThe match is dealt but this page did not move to the table. Tell the person to open /e/${environment_id} — the board picks the match up on its own once they are there.`;
          }
          desk.setOpponent("agent");

          // Somebody may already be sitting at this table. Dealing a second
          // match leaves two boards claiming the same game, and the person
          // clicks one while the agent watches the other.
          const open = (await api(`/api/matches?environment_id=${environment_id}`).catch(() => null))
            ?.match;
          let session = open?.id && !open.terminal ? await desk.join(String(open.id)) : null;
          const joined = !!session;
          if (!session) {
            session = await desk.start({
              seat: typeof human_seat === "number" ? human_seat : 0,
              agent_label: agent_label ? String(agent_label) : undefined,
            });
          }
          const seated = session!;

          const obs = await api(
            `/api/matches/${seated.match_id}/observation?seat=${seated.agent_seat}`,
          );
          const head = {
            match_id: seated.match_id,
            your_seat: seated.agent_seat,
            human_seat: seated.human_seat,
            joined_a_match_already_on_the_table: joined || undefined,
          };
          // Their turn opens the game, and the only moment this page can reach
          // the agent is while it is still inside a call — so the call stays
          // open through their first move instead of handing back to the chat.
          return `${clip(head, 600)}\n${await settle({
            id: seated.match_id,
            seat: seated.agent_seat,
            run,
            observation: obs,
          })}`;
        },
      },
      {
        name: "get_observation",
        title: "See the current position",
        description:
          "Your view of the current position, the actions you may legally take, and the revision to quote when you move. Defaults to the match on screen.",
        inputSchema: {
          type: "object",
          properties: {
            match_id: { type: "string", description: "Which match. Defaults to the one on screen." },
            seat: { type: "integer", description: "Whose view to take. Defaults to your own seat." },
          },
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: async ({ match_id, seat }, { signal }) => {
          const session = await currentMatch(match_id ? String(match_id) : undefined);
          const id = match_id ?? session?.match_id;
          if (!id) return "No match is running. Call start_match first.";
          const s = seat ?? session?.agent_seat;
          const q = s != null ? `?seat=${s}` : "";
          const res = await api(`/api/matches/${id}/observation${q}`, { signal });
          if (res.error) return clip(res);
          handOver();
          return `${clip(
            {
              match_id: id,
              seat: res.seat,
              revision: res.revision,
              to_move: res.to_move,
              your_turn: res.to_move === res.seat,
              terminal: res.terminal,
              rewards: res.rewards,
              observation: res.observation,
              legal_actions: res.legal_actions,
            },
            2000,
          )}\n${nextStep({
            terminal: res.terminal,
            your_turn: res.to_move === res.seat,
            rewards: res.rewards,
            seat: res.seat,
          })}`;
        },
      },
      {
        name: "take_action",
        title: "Play a move",
        description:
          "Play one legal action in the match on screen, then stay open through their reply and return the position with you to move again. One call per turn of yours is the whole game. Quote expected_revision from your last observation. Say why you picked it and how sure you are: both land on the trajectory beside the move, and they are the part of the record a person clicking a board cannot leave behind.",
        inputSchema: {
          type: "object",
          properties: {
            action: {
              type: "string",
              description: "One id copied from legal_actions, exactly as it was given.",
            },
            expected_revision: {
              type: "integer",
              description: "The revision your last observation reported, so a move lands on the position you saw.",
            },
            match_id: { type: "string", description: "Which match. Defaults to the one on screen." },
            rationale: {
              type: "string",
              description: "Why you chose this move, in a sentence. Recorded on the trajectory.",
            },
            confidence: {
              type: "integer",
              minimum: 1,
              maximum: 5,
              description: "How sure you are, 1 to 5. Recorded alongside the move.",
            },
          },
          required: ["action", "expected_revision", "rationale", "confidence"],
          additionalProperties: false,
        },
        annotations: { untrustedContentHint: true },
        execute: async ({ match_id, ...rest }, run) => {
          const session = await currentMatch(match_id ? String(match_id) : undefined);
          const id = match_id ?? session?.match_id;
          if (!id) return "No match is running. Call start_match first.";
          const res = await api(`/api/matches/${id}/action`, {
            method: "POST",
            body: JSON.stringify({
              ...rest,
              seat: session?.agent_seat,
              interface: "webmcp",
              latency_ms: decided(),
            }),
            signal: run.signal,
          });
          if (res.error) return clip(res);
          await currentDesk()?.refresh();
          // A row with no reasoning is the one thing a human click already gives
          // us. Say so rather than letting the dataset quietly lose the half
          // that only an agent can write.
          const thin = rest.rationale ? "" : "That move was recorded without a rationale, so its row reads like a click. Give one on the next move.\n";
          return settle({
            id: String(id),
            seat: session?.agent_seat,
            run,
            observation: {
              revision: res.match?.revision,
              to_move: res.match?.to_move,
              terminal: res.match?.terminal,
              rewards: res.match?.rewards,
              observation: res.observation?.observation,
              legal_actions: res.observation?.legal_actions,
            },
            prefix: `${JSON.stringify({ ok: true, played: rest.action })}\n${thin}`,
          });
        },
      },
      {
        name: "wait_for_turn",
        title: "Wait for the person to move",
        description:
          "Hold until the person has moved and it is your turn again, then return the position. The wait is long on purpose, because a person is thinking: it can take a minute. Stay in the call and the move arrives on its own.",
        inputSchema: {
          type: "object",
          properties: {
            match_id: { type: "string", description: "Which match. Defaults to the one on screen." },
            after_revision: {
              type: "integer",
              description: "The last revision you saw, so a move made while you were away still counts.",
            },
            timeout_ms: {
              type: "integer",
              description: "How long to hold before giving up, up to 110000ms. Defaults to a minute.",
            },
          },
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: async ({ match_id, after_revision, timeout_ms }, run) => {
          const session = await currentMatch(match_id ? String(match_id) : undefined);
          const id = match_id ?? session?.match_id;
          if (!id) return "No match is running. Call start_match first.";
          const after = after_revision ?? session?.revision ?? 0;
          const { res } = await holdForTurn({
            id: String(id),
            seat: session?.agent_seat,
            afterRevision: Number(after),
            run,
            budgetMs: Number(timeout_ms) || undefined,
          });
          if (res?.error) return clip(res);
          if (res?.status !== "ready" || !res.observation) {
            return `still_waiting — they have not moved yet (revision ${after}). Call wait_for_turn again to keep holding. If you would rather stop, tell them the board is waiting on them and that a message brings you back.`;
          }
          return settle({
            id: String(id),
            seat: session?.agent_seat,
            run,
            observation: res.observation,
          });
        },
      },
      {
        name: "export_episodes",
        title: "Show what the matches recorded",
        description:
          "What was recorded from the matches played here: the episode headers, one full sample row, and a download link for the complete JSONL. Defaults to the match on screen.",
        inputSchema: {
          type: "object",
          properties: {
            environment_id: { type: "string", description: "Every match played on this game." },
            match_id: { type: "string", description: "One match in particular." },
          },
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: async (input, { signal }) => {
          const q = new URLSearchParams();
          const id =
            input.match_id ?? (input.environment_id ? null : (await currentMatch())?.match_id);
          if (input.environment_id) q.set("environment_id", String(input.environment_id));
          if (id) q.set("match_id", String(id));
          const res = await api(`/api/episodes?${q}`, { signal });
          if (res.error) return clip(res);
          const records: Array<Record<string, unknown>> = res.records ?? [];
          const episodes = records.filter((r) => r.type === "episode");
          const steps = records.filter((r) => r.type === "step");
          // The whole file would blow past any sane context budget, so hand
          // back the shape plus a link rather than the bytes.
          const download = `${location.origin}/api/episodes?${q}&format=jsonl`;
          return clip(
            {
              episodes: episodes.length,
              steps: steps.length,
              download,
              headers: episodes.slice(0, 3),
              sample_step: steps[0] ?? null,
            },
            2400,
          );
        },
      },
    ];

    for (const tool of tools) {
      model
        .registerTool(
          {
            name: tool.name,
            title: tool.title,
            description: tool.description,
            inputSchema: tool.inputSchema,
            annotations: tool.annotations,
            // The second argument carries a signal that fires when the person or the
            // agent cancels mid-call. Work that outlives the call it belongs to is
            // work nobody is waiting for, so it is threaded into every request.
            execute: async (input, run) => {
              const ctx = (run ?? {}) as ToolRun;
              if (ctx.signal?.aborted) return "cancelled before it ran.";
              const playing =
                tool.name === "start_match" ||
                tool.name === "take_action" ||
                tool.name === "wait_for_turn";
              if (playing) beginAgentRun();
              const began = Date.now();
              let out: string;
              try {
                out = await tool.execute(input ?? {}, ctx);
              } catch (e) {
                out =
                  ctx.signal?.aborted || (e instanceof Error && e.name === "AbortError")
                    ? "cancelled."
                    : `error: ${e instanceof Error ? e.message : String(e)}`;
              } finally {
                if (playing) endAgentRun();
              }
              report({
                event: "tool",
                name: tool.name,
                ms: Date.now() - began,
                args: brief(input),
                answer: String(out).replace(/\s+/g, " ").slice(0, 300),
                path: location.pathname,
              });
              return out;
            },
          },
          { signal },
        )
        .catch(() => {
          // Strict Mode remounts; a duplicate name is expected and ignored.
        });
    }

    report({
      event: "tools_registered",
      count: tools.length,
      path: location.pathname,
      agent: navigator.userAgent.slice(0, 200),
    });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    void waitForDesk(0);
  }, []);

  return null;
}
