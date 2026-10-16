"use client";

import { useEffect, useState } from "react";
import type { CheckResult, InfoFlowRow, ValidationReport } from "@/lib/types";
import { playerName } from "@/lib/seats";

/** The check ids are internal. This is what each one actually proves. */
const CHECK_NAMES: Record<CheckResult["id"], string> = {
  V0: "Runs",
  V1: "Replays identically",
  V2: "Sealed sandbox",
  V3: "Rejects illegal moves",
  V4: "Every game ends",
  V5: "No hidden-state leaks",
  V6: "Table renders",
  V7: "Table paints the observation",
  V8: "Each player sees their own deal",
};

type Dataset = {
  schema_version: string;
  episode: { fields: string[] };
  step: {
    fields: string[];
    action_space_example: string[];
    reward_range: string;
  };
  sample_row: Record<string, unknown> | null;
};

export function DataPanel({
  environmentId,
  revision,
  report,
  players = 2,
}: {
  environmentId: string;
  revision: number;
  report: ValidationReport | null;
  players?: number;
}) {
  const [dataset, setDataset] = useState<Dataset | null>(null);

  useEffect(() => {
    let stale = false;
    const draw = async () => {
      try {
        const res = await fetch(`/api/environments/${environmentId}/dataset`, {
          cache: "no-store",
        });
        const body = (await res.json()) as Dataset & { error?: string };
        if (!stale && res.ok && !body.error) setDataset(body);
      } catch {
        /* the schema panel just stays out of the way */
      }
    };
    void draw();
    return () => {
      stale = true;
    };
    // The schema is derived from the code, so it moves when the revision does.
  }, [environmentId, revision]);

  return (
    <div>
      <Checks report={report} />
      <Schema dataset={dataset} />
      <Coverage coverage={report?.render_coverage} />
      <FlowMatrix rows={report?.info_flow ?? []} players={players} />
      <SampleRow row={dataset?.sample_row ?? null} />
    </div>
  );
}

function Checks({ report }: { report: ValidationReport | null }) {
  if (!report) return <p className="muted">Nothing has been checked yet.</p>;
  const failed = report.checks.filter((c) => !c.ok);
  const passed = report.checks.filter((c) => c.ok);
  return (
    <div>
      <p className={report.ok ? "ok" : "bad"}>
        {report.ok
          ? "Every check passed, so this game can be published and played."
          : `${failed.length} check${failed.length === 1 ? "" : "s"} failed, so this game cannot be published yet.`}
      </p>

      {failed.length > 0 && (
        <ul className="checks">
          {failed.map((c) => (
            <li key={c.id} className="bad">
              <strong>{CHECK_NAMES[c.id]}</strong> — {c.summary}
              {c.detail && <pre>{c.detail}</pre>}
            </li>
          ))}
        </ul>
      )}

      {passed.length > 0 && (
        <ul className="check-strip">
          {passed.map((c) => (
            <li key={c.id} title={c.summary}>
              {CHECK_NAMES[c.id]}
            </li>
          ))}
        </ul>
      )}

      {report.playouts && (
        <p className="note">
          {report.playouts.n} playouts · mean {report.playouts.mean_length} steps ·{" "}
          {report.playouts.ms} ms
        </p>
      )}
    </div>
  );
}

function Schema({ dataset }: { dataset: Dataset | null }) {
  if (!dataset) return null;
  return (
    <div className="tape">
      <div className="tape-head">
        <span>What a match records · {dataset.schema_version}</span>
      </div>
      <table className="shape">
        <tbody>
          <tr>
            <th>every episode</th>
            <td>{dataset.episode.fields.join(", ")}</td>
          </tr>
          <tr>
            <th>every step</th>
            <td>{dataset.step.fields.join(", ")}</td>
          </tr>
          {dataset.step.action_space_example.length > 0 && (
            <tr>
              <th>actions look like</th>
              <td>{dataset.step.action_space_example.slice(0, 10).join(", ")}</td>
            </tr>
          )}
          <tr>
            <th>rewards</th>
            <td>{dataset.step.reward_range}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Coverage({ coverage }: { coverage: ValidationReport["render_coverage"] }) {
  if (!coverage) return null;
  const { painted, dark } = coverage;
  const total = painted.length + dark.length;
  if (!total) return null;
  return (
    <div className="tape">
      <div className="tape-head">
        <span>
          What the table shows · {painted.length} of {total} fields
        </span>
      </div>
      {dark.length === 0 ? (
        // Listing forty rows that all say "drawn" buries the one case that matters.
        <p className="note">
          Every field the observation hands a player is painted somewhere on the table, so nothing
          is being played blind.
        </p>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>observation field</th>
                <th>on screen</th>
              </tr>
            </thead>
            <tbody>
              {dark.concat(painted.slice(0, 20)).map((field) => (
                <tr key={field}>
                  <td>{field}</td>
                  <td className={dark.includes(field) ? "paint-off" : "paint-on"}>
                    {dark.includes(field) ? "not drawn" : "drawn"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="note">
            A field nobody paints is a field the person is playing without. Either draw it or drop
            it from observe().
          </p>
        </>
      )}
    </div>
  );
}

export function FlowMatrix({ rows, players }: { rows: InfoFlowRow[]; players: number }) {
  if (!rows.length) return null;
  // What makes a game a hidden-information game is asymmetry: one seat told
  // something the other is not. A field kept from everyone is just bookkeeping,
  // and a table of identical "visible" rows is a wall of text saying nothing.
  const split = rows.filter((r) => r.seats.includes("visible") && r.seats.includes("hidden"));
  const leaks = rows.filter((r) => r.seats.includes("leak"));
  const shared = rows.filter((r) => r.seats.every((s) => s === "visible"));
  const internal = rows.filter((r) => r.seats.every((s) => s === "hidden"));
  const worth = leaks.concat(split);
  return (
    <div className="tape">
      <div className="tape-head">
        <span>Who sees what</span>
      </div>
      {worth.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>field</th>
              {Array.from({ length: players }).map((_, i) => (
                <th key={i}>{playerName(i)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {worth.map((r) => (
              <tr key={r.field}>
                <td>{r.field}</td>
                {r.seats.map((s, i) => (
                  <td key={i} className={`flow-${s}`}>
                    {s}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="note">
          Nothing is dealt here — both players are handed the same {shared.length} fields, which is
          what a game of perfect information should look like.
        </p>
      )}
      {worth.length > 0 && (
        <p className="note">
          {leaks.length > 0
            ? "A leak means a player is being handed something they should not know. Fix observe() before publishing."
            : `${split.length} field${split.length === 1 ? "" : "s"} differ by player, which is the hidden information this game is built on.`}
        </p>
      )}
      {internal.length > 0 && (
        <p className="note">
          Kept from both players: {internal.map((r) => r.field).join(", ")} — internal bookkeeping
          observe() never hands out.
        </p>
      )}
    </div>
  );
}

function SampleRow({ row }: { row: Record<string, unknown> | null }) {
  if (!row) return null;
  return (
    <div className="tape">
      <div className="tape-head">
        <span>Sample data</span>
      </div>
      <p className="note">
        A real row from a playout, in the shape every move lands in — whether a person clicked it or
        an agent called take_action. Player 1 is seat 0 in the file.
      </p>
      <pre className="code-block">{JSON.stringify(row, null, 2)}</pre>
    </div>
  );
}
