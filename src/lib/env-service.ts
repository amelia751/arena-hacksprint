import { CODE_KEYS, EMPTY_CODE, type EnvCode, type EnvCodePatch, type Environment } from "./types";
import { codeHash, nid, now } from "./ids";
import { getEnvironment, listEnvironments, putEnvironment } from "./store";
import { validateEnvironment } from "./validate";
import { AUTHORING_GUIDE } from "./guide";
import { withRealm } from "./sandbox";
import { parseRender, sanitizeView } from "./view";

function mergeCode(base: EnvCode, patch?: EnvCodePatch): EnvCode {
  const next = { ...base };
  if (!patch) return next;
  for (const k of CODE_KEYS) {
    if (typeof patch[k] === "string") next[k] = patch[k] as string;
  }
  return next;
}

/** How long after writing a game the same game arriving again counts as a repeat. */
const REPEAT_WINDOW = 5 * 60 * 1000;

async function recentTwin(name: string, hash: string): Promise<Environment | null> {
  const cutoff = Date.now() - REPEAT_WINDOW;
  const rows = await listEnvironments();
  return (
    rows.find(
      (env) =>
        env.name === name &&
        env.code_hash === hash &&
        !env.published &&
        Date.parse(env.created_at) >= cutoff,
    ) ?? null
  );
}

function publicEnv(env: Environment) {
  return {
    id: env.id,
    name: env.name,
    description: env.description,
    players: env.players,
    revision: env.revision,
    code_hash: env.code_hash,
    kind: env.kind ?? "authored",
    published: env.published,
    confirmed_info_flow: env.confirmed_info_flow,
    validation: env.validation
      ? {
          ok: env.validation.ok,
          failures: env.validation.failures,
          checks: env.validation.checks,
          info_flow: env.validation.info_flow,
          playouts: env.validation.playouts,
          render_coverage: env.validation.render_coverage,
        }
      : null,
    created_at: env.created_at,
    updated_at: env.updated_at,
  };
}

export function getAuthoringGuide() {
  return { guide: AUTHORING_GUIDE };
}

export type TraceRow = {
  n: number;
  seat?: unknown;
  state?: string;
  legal?: string[];
  observation?: string;
  action?: string;
  rewards?: number[];
  terminal?: boolean;
  error?: string;
};

/** Walk a game move by move and report what each function saw on the way. */
export async function traceEnv(
  id: string,
  opts: { seed?: number; actions?: string[]; max_steps?: number } = {},
) {
  const env = await getEnvironment(id);
  if (!env) return { error: "environment not found", status: 404 as const };
  try {
    return await withRealm(env.code, async (realm) => {
      const out = await realm.call<{ rows: TraceRow[]; stopped: string; final?: string }>(
        "__trace",
        {
          seed: opts.seed ?? 0,
          actions: opts.actions ?? [],
          max_steps: Math.min(Math.max(opts.max_steps ?? 12, 1), 60),
        },
        10000,
      );
      return { environment_id: env.id, seed: opts.seed ?? 0, ...out };
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), status: 400 as const };
  }
}

export async function previewEnv(
  id: string,
  opts: { seed?: number; seat?: number; moves?: string[] } = {},
) {
  const env = await getEnvironment(id);
  if (!env) return { error: "environment not found", status: 404 as const };
  const seed = opts.seed ?? 0;
  const moves = opts.moves ?? [];
  try {
    return await withRealm(env.code, async (realm) => {
      let state = await realm.call("__init", { seed });
      const played: string[] = [];
      for (const action of moves) {
        const stepped = await realm.call<{ state: unknown; terminal: boolean }>("__step", {
          state,
          action,
        });
        state = stepped.state;
        played.push(action);
        if (stepped.terminal) break;
      }
      const toMove =
        state && typeof state === "object" && typeof (state as { to_move?: number }).to_move === "number"
          ? (state as { to_move: number }).to_move
          : 0;
      const seat = opts.seat ?? toMove;
      const observation = await realm.call("__observe", { state, player: seat });
      const legal = await realm.call<string[]>("__legal", { state, player: seat });
      const rendered = await realm.call("__render", { observation });
      const parsed = parseRender(rendered);
      if (parsed.kind === "html") {
        const clean = sanitizeView(parsed.view);
        return {
          environment_id: env.id,
          revision: env.revision,
          seed,
          seat,
          to_move: toMove,
          moves: played,
          observation,
          legal_actions: legal,
          view: clean.view,
          stripped: clean.stripped,
        };
      }
      return {
        environment_id: env.id,
        seed,
        seat,
        to_move: toMove,
        observation,
        legal_actions: legal,
        render: rendered,
        note: "render returned a UI tree. Rewrite it to { html, css } so you can style the table.",
      };
    });
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : String(e),
      status: 400 as const,
    };
  }
}

export async function listEnvs() {
  const rows = await listEnvironments();
  return {
    environments: rows.map(publicEnv),
    note:
      rows.length === 0
        ? "Nothing has been written here yet. create_environment starts an empty one; read the authoring guide first."
        : undefined,
  };
}

export async function getEnv(id: string, fn?: keyof EnvCode) {
  const env = await getEnvironment(id);
  if (!env) return { error: "environment not found", status: 404 as const };
  if (fn) {
    if (!CODE_KEYS.includes(fn)) return { error: `unknown function ${fn}`, status: 400 as const };
    return {
      id: env.id,
      revision: env.revision,
      function: fn,
      source: env.code[fn],
    };
  }
  return { ...publicEnv(env), code: env.code };
}

export async function createEnv(input: {
  name: string;
  description?: string;
  players?: number;
  code?: EnvCodePatch;
}) {
  if (!input.name?.trim()) return { error: "name is required", status: 400 as const };
  const code = mergeCode(EMPTY_CODE, input.code);
  const players = input.players ?? 2;
  const name = input.name.trim();

  /*
   * A save that takes a while can look to the caller like a save that failed,
   * and the natural response is to send it again. Two identical games a moment
   * apart is that, not somebody wanting two — hand back the one already written.
   */
  const twin = await recentTwin(name, codeHash(code));
  if (twin) return { environment: { ...publicEnv(twin), code: twin.code } };

  const validation = await safeValidate(code, players, false);
  const t = now();
  const env: Environment = {
    id: nid("env"),
    name,
    description: input.description?.trim() || "",
    players,
    code,
    revision: 1,
    code_hash: codeHash(code),
    kind: "authored",
    published: false,
    confirmed_info_flow: false,
    validation,
    created_at: t,
    updated_at: t,
  };
  await putEnvironment(env);
  return { environment: { ...publicEnv(env), code: env.code } };
}

export async function updateEnv(input: {
  id: string;
  expected_revision: number;
  name?: string;
  description?: string;
  code?: EnvCodePatch;
}) {
  const env = await getEnvironment(input.id);
  if (!env) return { error: "environment not found", status: 404 as const };
  if (env.published) {
    return {
      error: "a published environment is frozen — fork_environment to change it",
      status: 409 as const,
    };
  }
  if (env.revision !== input.expected_revision) {
    return {
      error: `revision conflict: have ${env.revision}, expected ${input.expected_revision}`,
      status: 409 as const,
    };
  }
  const code = mergeCode(env.code, input.code);
  const validation = await safeValidate(code, env.players, false);
  const next: Environment = {
    ...env,
    name: input.name?.trim() || env.name,
    description: input.description !== undefined ? input.description : env.description,
    code,
    revision: env.revision + 1,
    code_hash: codeHash(code),
    validation,
    updated_at: now(),
  };
  await putEnvironment(next);
  return { environment: { ...publicEnv(next), code: next.code } };
}

export async function forkEnv(input: { source_id: string; name: string }) {
  const src = await getEnvironment(input.source_id);
  if (!src) return { error: "source environment not found", status: 404 as const };
  if (!input.name?.trim()) return { error: "name is required", status: 400 as const };
  const t = now();
  const code = src.code;
  const env: Environment = {
    ...src,
    id: nid("env"),
    name: input.name.trim(),
    code,
    code_hash: codeHash(code),
    kind: "authored",
    published: false,
    confirmed_info_flow: false,
    revision: 1,
    created_at: t,
    updated_at: t,
  };
  env.validation = await safeValidate(env.code, env.players, false);
  await putEnvironment(env);
  return { environment: { ...publicEnv(env), code: env.code, forked_from: src.id } };
}

export async function validateEnv(id: string, episodes?: number, publish = false) {
  const env = await getEnvironment(id);
  if (!env) return { error: "environment not found", status: 404 as const };
  const validation = await safeValidate(env.code, env.players, publish, episodes);
  const next = { ...env, validation, updated_at: now() };
  await putEnvironment(next);
  return { id: next.id, revision: next.revision, validation };
}

export async function publishEnv(input: {
  id: string;
  expected_revision: number;
  confirm_info_flow?: boolean;
}) {
  const env = await getEnvironment(input.id);
  if (!env) return { error: "environment not found", status: 404 as const };
  if (env.revision !== input.expected_revision) {
    return {
      error: `revision conflict: have ${env.revision}, expected ${input.expected_revision}`,
      status: 409 as const,
    };
  }
  const validation = await safeValidate(env.code, env.players, true);
  if (!validation.ok) {
    return {
      error: "publish blocked — validation failed",
      validation,
      status: 400 as const,
    };
  }
  const asymmetric = validation.info_flow.filter(
    (row) => new Set(row.seats).size > 1,
  );
  const confirmed = input.confirm_info_flow === true || env.confirmed_info_flow;
  if (asymmetric.length && !confirmed) {
    return {
      error:
        "publish blocked — this game hides information from at least one seat, so the information-flow matrix has to be confirmed. Read the rows below and re-publish with confirm_info_flow: true if each one is correct.",
      info_flow: asymmetric,
      status: 409 as const,
    };
  }
  const next: Environment = {
    ...env,
    validation,
    published: true,
    confirmed_info_flow: confirmed,
    updated_at: now(),
  };
  await putEnvironment(next);
  return {
    environment: publicEnv(next),
    url: `/e/${next.id}`,
  };
}

export async function describeDataset(id: string) {
  const env = await getEnvironment(id);
  if (!env) return { error: "environment not found", status: 404 as const };
  const validation = env.validation ?? (await safeValidate(env.code, env.players, false, 80));
  let sample = validation.sample_step;
  if (!sample) {
    try {
      sample = await withRealm(env.code, async (realm) => {
        const p = await realm.call<{
          last_obs?: unknown;
          last_legal?: string[];
          last_seat?: number;
          actions?: string[];
          rewards?: number[];
        }>("__playout", { seed: 0, policy_seed: 1, max_steps: 40, collect: true });
        return {
          observation: p.last_obs,
          legal_actions: p.last_legal,
          seat: p.last_seat,
          action: p.actions?.at(-1),
          reward: 0,
          terminal: true,
        };
      });
    } catch {
      sample = undefined;
    }
  }
  return {
    environment_id: env.id,
    code_hash: env.code_hash,
    schema_version: "arena-1",
    episode: {
      type: "episode",
      fields: ["match_id", "environment", "seed", "seats", "returns", "length"],
    },
    step: {
      type: "step",
      fields: [
        "observation",
        "legal_actions",
        "action",
        "reward",
        "terminal",
        "presented_order",
        "latency_ms",
        "rationale",
        "confidence",
      ],
      observation_example: sample?.observation ?? null,
      action_space_example: sample?.legal_actions ?? [],
      reward_range: "zero-sum, typically -1..1 per seat at terminal, 0 otherwise",
    },
    playouts: validation.playouts ?? null,
    sample_row: sample
      ? {
          type: "step",
          ...sample,
          interface: "webmcp",
          rationale: null,
          confidence: null,
        }
      : null,
  };
}

async function safeValidate(
  code: EnvCode,
  players: number,
  publish: boolean,
  episodes?: number,
) {
  try {
    return await validateEnvironment(code, { players, publish, episodes });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      checks: [
        {
          id: "V0" as const,
          ok: false,
          summary: "Does not run",
          detail: message,
        },
      ],
      failures: [`V0: ${message}`],
      info_flow: [],
    };
  }
}
