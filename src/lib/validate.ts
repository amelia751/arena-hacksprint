import type {
  CheckResult,
  EnvCode,
  InfoFlowRow,
  ValidationReport,
} from "./types";
import { SandboxError, runtimeInfo, withRealm } from "./sandbox";
import { parseRender, validateAuthoredView } from "./view";

const LEAK_NAME = /(rng|seed|cursor|secret|private|hidden|burned|deck|internal)/i;

/** Containers whose per-seat slot is that seat's secret: hands[0] belongs to seat 0. */
const PRIVATE_CONTAINER = /^(hands?|cards?|holdings?|private|hidden|secrets?)$/i;
/** Zones inside a per-seat record that are that seat's secret. */
const PRIVATE_ZONE = /^(hands?|cards?|deck|draw|held|reserve|private|hidden|secrets?)$/i;

function guestError(e: unknown): string {
  if (e instanceof SandboxError) {
    const loc = e.stackFromGuest
      ? e.stackFromGuest.split("\n").map((l) => l.trim()).filter(Boolean)[0]
      : "";
    const fn = e.fn ? `${e.fn}` : "environment";
    return loc ? `${fn}: ${e.message} (${loc})` : `${fn}: ${e.message}`;
  }
  return e instanceof Error ? e.message : String(e);
}

/**
 * A stack line says which line threw. It does not say what the position looked
 * like when it did, which is the thing you actually need to fix it — so the
 * failing state, seat and action travel back with the failure.
 */
function whereItBroke(f: {
  at_step?: number;
  seat?: number;
  state?: string;
  action?: string;
  legal?: string[];
  seed?: number;
}): string {
  if (f.state === undefined && f.at_step === undefined) return "";
  const lines = ["It broke here — read the state and work out which value is missing:"];
  const where = [
    f.seed !== undefined ? `seed ${f.seed}` : null,
    f.at_step !== undefined ? `step ${f.at_step}` : null,
    f.seat !== undefined ? `seat ${f.seat} to move` : null,
  ].filter(Boolean);
  if (where.length) lines.push(`  at: ${where.join(", ")}`);
  if (f.action !== undefined) lines.push(`  action being applied: ${f.action}`);
  if (f.legal?.length) lines.push(`  legal there: ${f.legal.join(" ")}`);
  if (f.state !== undefined) lines.push(`  state: ${f.state}`);
  return lines.join("\n");
}

function classifyFlow(
  field: string,
  visible: boolean[],
): InfoFlowRow {
  // players[0].hand is seat 0's secret; players[0].active is a piece both players
  // can see. Only the private zone is a leak — failing the public one would make
  // any game with a shared board impossible to publish.
  const owned = field.match(/^([A-Za-z_]\w*)\.(\d+)(?:\.([A-Za-z_]\w*))?/);
  const seats = visible.map((v, seat) => {
    if (!v) return "hidden" as const;
    if (LEAK_NAME.test(field)) return "leak" as const;
    if (owned) {
      const owner = Number(owned[2]);
      if (!Number.isNaN(owner) && owner !== seat) {
        if (PRIVATE_CONTAINER.test(owned[1])) return "leak" as const;
        if (owned[3] && PRIVATE_ZONE.test(owned[3])) return "leak" as const;
      }
    }
    return "visible" as const;
  });
  return { field, seats };
}

export async function validateEnvironment(
  code: EnvCode,
  opts?: { players?: number; episodes?: number; publish?: boolean },
): Promise<ValidationReport> {
  const players = opts?.players ?? 2;
  const episodes = opts?.episodes ?? (opts?.publish ? 1000 : 300);
  /*
   * How long the playout sweep may run for.
   *
   * Publishing is a deliberate act and the caller expects to wait for it. Saving
   * a draft is not: an expensive game could spend twenty seconds here, long
   * enough for the assistant to give up on the call, decide the save had failed
   * and write the game a second time. A draft gets a quick look instead, and the
   * report says when it was cut short.
   */
  const sweepBudget = opts?.publish ? 20000 : 2000;
  const checks: CheckResult[] = [];
  const failures: string[] = [];
  let info_flow: InfoFlowRow[] = [];
  let playouts: ValidationReport["playouts"];
  let sample_step: Record<string, unknown> | undefined;
  let render_coverage: ValidationReport["render_coverage"];

  const push = (c: CheckResult) => {
    checks.push(c);
    if (!c.ok) {
      const text = c.detail || c.summary;
      failures.push(text.startsWith(`${c.id}:`) ? text : `${c.id}: ${text}`);
    }
  };

  try {
    await withRealm(code, async (realm) => {
      // V0
      try {
        const p = await realm.call<{
          error?: string;
          fn?: string;
          stack?: string;
          steps?: number;
          last_obs?: unknown;
          last_legal?: string[];
          at_step?: number;
          seat?: number;
          state?: string;
          action?: string;
          legal?: string[];
        }>("__playout", { seed: 1, policy_seed: 1, max_steps: 8, collect: true }, 2000);
        if (p.error && p.fn !== "step" && !String(p.error).includes("did not terminate")) {
          push({
            id: "V0",
            ok: false,
            summary: "Does not run",
            detail:
              `${p.fn || "environment"}: ${p.error}${p.stack ? ` (${p.stack.split("\n")[0]})` : ""}\n` +
              whereItBroke(p),
          });
          return;
        }
        push({
          id: "V0",
          ok: true,
          summary: "Parses, init returns a state, a step completes",
        });
      } catch (e) {
        push({ id: "V0", ok: false, summary: "Does not run", detail: guestError(e) });
        return;
      }

      // V1 determinism
      try {
        const a = await realm.call<{ error?: string; actions?: string[]; trace?: string }>(
          "__playout",
          { seed: 1234, policy_seed: 7, max_steps: 200 },
          2000,
        );
        const b = await realm.call<{ error?: string; actions?: string[]; trace?: string }>(
          "__playout",
          { seed: 1234, policy_seed: 7, max_steps: 200 },
          2000,
        );
        if (a.error || b.error) {
          push({
            id: "V1",
            ok: false,
            summary: "Could not replay",
            detail: a.error || b.error,
          });
        } else if (a.trace !== b.trace) {
          push({
            id: "V1",
            ok: false,
            summary: "Same seed produced two different traces",
            detail:
              "V1: two playouts with seed=1234 and the same policy seed hashed to different states. Remove Date, Math.random, and any hidden mutation. Use rng(state.rng_cursor) and write the next cursor back into state.",
          });
        } else {
          const replay = await realm.call<{ trace: string }>("__replay", {
            seed: 1234,
            actions: a.actions,
          });
          push({
            id: "V1",
            ok: replay.trace === a.trace,
            summary: "Same (seed, actions) yields identical states",
            detail:
              replay.trace === a.trace
                ? undefined
                : "Replaying the recorded action list produced a different state hash.",
          });
        }
      } catch (e) {
        push({ id: "V1", ok: false, summary: "Determinism check threw", detail: guestError(e) });
      }

      // V2 purity — prelude already strips Date/random; we just confirm a second host run matches
      push({
        id: "V2",
        ok: checks.find((c) => c.id === "V1")?.ok ?? false,
        summary: `Ran in Daytona sandbox ${(await runtimeInfo()).sandbox.slice(0, 8)} with no network; Date, Math.random, fetch, process, require are unavailable`,
        detail: checks.find((c) => c.id === "V1")?.ok
          ? undefined
          : "Purity is enforced by the sandbox; failing V1 usually means leftover ambient randomness in how you thread rng_cursor.",
      });

      // V3 mask soundness
      try {
        const illegal = await realm.call<{ accepted: boolean; error?: string; legal: string[] }>(
          "__illegal",
          { seed: 3, action: "__not_a_real_action__" },
        );
        if (illegal.accepted) {
          push({
            id: "V3",
            ok: false,
            summary: "step accepted an illegal action",
            detail:
              "V3: step() accepted '__not_a_real_action__', which was not in legal_actions. Throw (or return without mutating) when the action is absent from legal_actions(state, state.to_move).",
          });
        } else if (!illegal.legal?.length) {
          push({
            id: "V3",
            ok: false,
            summary: "legal_actions empty at kickoff",
            detail: "V3: legal_actions(init(seed), to_move) returned []. A non-terminal state must have at least one legal action.",
          });
        } else {
          push({
            id: "V3",
            ok: true,
            summary: "step rejects actions outside the mask; kickoff mask is non-empty",
          });
        }
      } catch (e) {
        push({ id: "V3", ok: false, summary: "Mask check threw", detail: guestError(e) });
      }

      // V4 + sample + V6
      const t0 = performance.now();
      try {
        type Sweep = {
          error?: string;
          fn?: string;
          stack?: string;
          at_step?: number;
          seat?: number;
          state?: string;
          action?: string;
          legal?: string[];
          seed?: number;
          n?: number;
          steps?: number;
          balance?: number[];
          sample?: {
            steps: number;
            actions: string[];
            rewards: number[];
            last_obs: unknown;
            last_legal: string[];
            last_seat: number;
            render?: unknown;
            render_error?: string;
          };
        };
        const runSweep = (n: number) =>
          realm.call<Sweep>(
            "__sweep",
            { n, max_steps: 200, seed0: 0 },
            Math.min(60000, 10000 + n * 30),
          );
        // Price a few playouts before committing to the full sweep. An expensive
        // step() is not wrong, so it gets verified over fewer playouts rather than
        // stalling until the sandbox interrupts it.
        // The probe is paid before the budget gets a say, so on a draft it stays
        // small — forty playouts of an expensive game is most of the wait on its
        // own, whatever the budget says afterwards.
        const probeN = Math.min(opts?.publish ? 40 : 6, episodes);
        let sweep: Sweep = await runSweep(probeN);
        const perEpisode = realm.lastRunMs() / probeN;
        let ran = probeN;
        let trimmedForTime = false;
        if (!sweep.error) {
          const affordable = Math.max(probeN, Math.floor(sweepBudget / Math.max(perEpisode, 0.01)));
          ran = Math.min(episodes, affordable);
          trimmedForTime = ran < episodes;
          if (ran > probeN) sweep = await runSweep(ran);
        }
        const ms = performance.now() - t0;
        if (sweep.error) {
          push({
            id: "V4",
            ok: false,
            summary: "A random playout failed or never ended",
            detail:
              `V4: ${sweep.fn || "environment"}: ${sweep.error}${sweep.stack ? ` (${sweep.stack.split("\n")[0]})` : ""}\n` +
              whereItBroke(sweep),
          });
        } else {
          const mean = (sweep.steps || 0) / (sweep.n || 1);
          playouts = {
            n: sweep.n || ran,
            steps: sweep.steps || 0,
            mean_length: Math.round(mean * 10) / 10,
            balance: sweep.balance || [0, 0, 0],
            ms: Math.round(ms),
          };
          push({
            id: "V4",
            ok: true,
            summary: `${playouts.n} playouts all terminated (mean ${playouts.mean_length} steps, ${playouts.ms}ms)`,
            detail: trimmedForTime
              ? `V4: every playout ended, but ${episodes} of them did not fit in the time budget, so ${playouts.n} were run. Each step is expensive — deep-copying the whole state on every move is the usual reason — and that cost is paid again on every move of a real match.`
              : undefined,
          });
          if (sweep.sample) {
            sample_step = {
              observation: sweep.sample.last_obs,
              legal_actions: sweep.sample.last_legal,
              seat: sweep.sample.last_seat,
              action: sweep.sample.actions.at(-1),
              reward: sweep.sample.rewards?.[sweep.sample.last_seat ?? 0] ?? 0,
              terminal: true,
            };
          }
          const renderNode = sweep.sample?.render;
          const renderErr = sweep.sample?.render_error;
          if (renderErr) {
            push({
              id: "V6",
              ok: false,
              summary: "render threw",
              detail: `V6: render: ${renderErr}`,
            });
          } else {
            const parsed = parseRender(renderNode);
            if (parsed.kind === "html") {
              const viewErrors = validateAuthoredView(
                parsed.view,
                sweep.sample?.last_legal,
              );
              push({
                id: "V6",
                ok: viewErrors.length === 0,
                summary:
                  viewErrors.length === 0
                    ? "render returns HTML/CSS the table can host"
                    : "render HTML failed the view checks",
                detail: viewErrors[0],
              });
            } else if (parsed.kind === "tree") {
              push({
                id: "V6",
                ok: false,
                summary: "render returned a UI tree — write { html, css } instead",
                detail:
                  "V6: render must return { html: string, css: string }. Put data-action on clickable elements. A typed UI tree is not accepted.",
              });
            } else {
              push({
                id: "V6",
                ok: false,
                summary: "render must return { html, css }",
                detail: parsed.errors[0],
              });
            }
          }
        }
      } catch (e) {
        const stalled = e instanceof SandboxError && /interrupt/i.test(e.message);
        push({
          id: "V4",
          ok: false,
          summary: stalled ? "Playouts are too slow to finish" : "Sweep threw",
          detail: stalled
            ? "V4: playouts ran out of time even after cutting their number down. A single move is costing far too much work — look for a deep copy of the whole state, or a loop over the whole deck, on every step() — and make step() cheaper."
            : guestError(e),
        });
      }

      // V8 — can every seat see its own deal?
      try {
        const deal = await realm.call<{
          error?: string;
          fn?: string;
          distinct?: number[];
          samples?: unknown[];
          corrupt?: string[];
        }>("__deal_visibility", { players, seeds: 24 }, 5000);
        if (deal.error) {
          push({
            id: "V8",
            ok: false,
            summary: "Could not deal repeatedly",
            detail: `V8: ${deal.fn || "init"}: ${deal.error}`,
          });
        } else if (deal.corrupt?.length) {
          const paths = Array.from(new Set(deal.corrupt));
          push({
            id: "V8",
            ok: false,
            summary: "The deal produces undefined values",
            detail:
              `V8: ${paths.join("; ")}. Anything undefined disappears when the observation is serialized, so the player never sees it.\n` +
              `The usual cause is indexing an array with a fraction: rng(cursor) returns a float between 0 and 1, so rng(c) % n is not a whole number. Use Math.floor(rng(c) * n).`,
          });
        } else {
          const distinct = deal.distinct ?? [];
          const most = Math.max(0, ...distinct);
          const blind = distinct
            .map((n, seat) => ({ n, seat }))
            .filter((row) => most > 1 && row.n <= 1);
          if (blind.length) {
            const names = blind.map((b) => `seat ${b.seat}`).join(" and ");
            push({
              id: "V8",
              ok: false,
              summary: `${names} cannot see the deal`,
              detail:
                `V8: over 24 deals, some seats saw ${most} different opening positions but ${names} saw the same thing every time — that seat is playing blind.\n` +
                `observe(state, player) must give each player their own private information. Return the card, hand or piece that belongs to \`player\`, and only that one.\n` +
                `Sample of what ${blind[0] ? `seat ${blind[0].seat}` : "that seat"} was given: ${JSON.stringify(deal.samples?.[blind[0].seat]).slice(0, 200)}`,
            });
          } else {
            push({
              id: "V8",
              ok: true,
              summary:
                most > 1
                  ? `Every seat sees its own deal (${distinct.join(" and ")} distinct openings)`
                  : "The opening position is the same for everyone, as it should be in a game with no deal",
            });
          }
        }
      } catch (e) {
        push({ id: "V8", ok: false, summary: "Deal visibility check threw", detail: guestError(e) });
      }

      // V7 render coverage — does the markup actually show the position?
      try {
        const cov = await realm.call<{
          error?: string;
          fn?: string;
          seat?: number;
          painted?: string[];
          dark?: string[];
          skipped?: string[];
        }>("__render_coverage", { seed: 5, policy_seed: 11, depth: 4 }, 5000);
        if (cov.error) {
          push({
            id: "V7",
            ok: false,
            summary: "Could not check what render paints",
            detail: `V7: ${cov.fn || "render"}: ${cov.error}`,
          });
        } else {
          const painted = cov.painted ?? [];
          const dark = cov.dark ?? [];
          const checked = painted.length + dark.length;
          render_coverage = { painted, dark, skipped: cov.skipped ?? [], seat: cov.seat ?? 0 };
          const ratio = checked ? painted.length / checked : 0;
          if (checked === 0) {
            push({
              id: "V7",
              ok: true,
              summary: "Observation has no scalar fields to check against the markup",
            });
          } else if (ratio < 0.6) {
            const named = dark.slice(0, 8).join(", ");
            push({
              id: "V7",
              ok: false,
              summary: `render paints only ${painted.length} of ${checked} observation fields`,
              detail:
                `V7: changing these observation fields does not change the markup at all, so the person cannot see them: ${named}${dark.length > 8 ? `, +${dark.length - 8} more` : ""}.\n` +
                `render(observation) must read the observation and paint it — draw every cell, card, and counter from the values it is given, not from constants.`,
            });
          } else {
            push({
              id: "V7",
              ok: true,
              summary: `render paints ${painted.length} of ${checked} observation fields`,
              detail: dark.length
                ? `Not shown anywhere in the markup: ${dark.slice(0, 8).join(", ")}. Consider painting them so the person can see them.`
                : undefined,
            });
          }
        }
      } catch (e) {
        push({ id: "V7", ok: false, summary: "Render coverage check threw", detail: guestError(e) });
      }

      // V5 information flow
      try {
        const flow = await realm.call<{
          error?: string;
          rows?: Array<{ field: string; visible: boolean[] }>;
        }>("__info_flow", { seed: 42, players }, 3000);
        if (flow.error) {
          push({
            id: "V5",
            ok: false,
            summary: "Could not build the information-flow matrix",
            detail: `V5: ${flow.error}`,
          });
        } else {
          info_flow = (flow.rows || []).map((r) => classifyFlow(r.field, r.visible));
          const leaks = info_flow.filter((r) => r.seats.includes("leak"));
          if (leaks.length) {
            const lines = leaks.map((r) => {
              const who = r.seats
                .map((s, i) => (s === "leak" ? `seat ${i}` : null))
                .filter(Boolean)
                .join(" and ");
              return `  ${r.field} is visible to ${who}`;
            });
            push({
              id: "V5",
              ok: false,
              summary: `${leaks.length} field(s) leak across the observation boundary`,
              detail:
                `V5: observe() exposes fields a seat should not see:\n${lines.join("\n")}\nProject observe(state, player) down to that player's information. Do not return the raw state object.`,
            });
          } else {
            push({
              id: "V5",
              ok: true,
              summary: "No seat-index or hidden-name leaks in observe()",
            });
          }
        }
      } catch (e) {
        push({ id: "V5", ok: false, summary: "Information-flow check threw", detail: guestError(e) });
      }
    });
  } catch (e) {
    if (!checks.some((c) => c.id === "V0")) {
      push({ id: "V0", ok: false, summary: "Does not run", detail: guestError(e) });
    }
  }

  return {
    ok: failures.length === 0,
    // Checks land in the order they finish, which is not the order they are named
    // in. Anyone reading the report expects V0 first.
    checks: checks.slice().sort((a, b) => a.id.localeCompare(b.id)),
    failures,
    info_flow,
    playouts,
    sample_step,
    render_coverage,
  };
}
