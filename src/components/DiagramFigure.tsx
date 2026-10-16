import { Brand, Icon, type Glyph } from "@/components/diagram-kit";

function Arrow({ label, area }: { label: string; area: string }) {
  return (
    <div className={`dg-arrow dg-${area}`} aria-hidden="true">
      <span>{label}</span>
      <b>→</b>
    </div>
  );
}

const FNS: Array<[string, string]> = [
  ["init", "seed → state"],
  ["legal_actions", "→ action mask"],
  ["observe", "→ per-seat view"],
  ["step", "→ reward + done"],
  ["render", "→ html + css"],
];

const CHECKS: Array<[string, string]> = [
  ["V0", "it runs"],
  ["V1", "same seed replays"],
  ["V2", "no ambient authority"],
  ["V3", "illegal rejected"],
  ["V4", "playouts terminate"],
  ["V5", "no seat leak"],
  ["V6", "hostable html"],
  ["V7", "markup follows obs"],
  ["V8", "own deal, no undefined"],
];

const TOOLS: Array<{ group: string; glyph: Glyph; tone: string; names: string[] }> = [
  {
    group: "Author",
    glyph: "book",
    tone: "#c69a12",
    names: [
      "get_authoring_guide",
      "list_environments",
      "get_environment",
      "create_environment",
      "update_environment",
      "fork_environment",
    ],
  },
  { group: "See", glyph: "eye", tone: "#4a6fc4", names: ["preview_view", "inspect_view"] },
  {
    group: "Verify",
    glyph: "shield",
    tone: "#1a7f37",
    names: ["validate_environment", "trace_episode", "describe_dataset"],
  },
  {
    group: "Play",
    glyph: "play",
    tone: "#8e4fa0",
    names: [
      "publish_environment",
      "open_environment",
      "start_match",
      "get_observation",
      "take_action",
      "wait_for_turn",
    ],
  },
  { group: "Keep", glyph: "save", tone: "#0f7a74", names: ["export_episodes"] },
];

export function DiagramFigure() {
  return (
    <figure className="diagram">
      <div className="dg">
        <section className="dg-box dg-human">
          <header>
            <Icon glyph="person" />
            <p className="kicker">Human</p>
          </header>
          <p className="dg-sub">Plays in the browser</p>
          <ul className="dg-rows">
            <li>
              <b>Table</b> click <code>data-action</code>
            </li>
            <li>
              <b>Inspect</b> walk a deal, pin a seat
            </li>
            <li>
              <b>Data</b> schema + recorded step
            </li>
          </ul>
        </section>

        <Arrow label="render + click" area="ah" />

        <section className="dg-box dg-agent">
          <header>
            <Icon glyph="plug" />
            <p className="kicker">Agent</p>
          </header>
          <p className="dg-sub">Calls tools on the same page</p>
          <div className="dg-brands">
            <Brand src="/diagram/webmcp.svg" label="WebMCP" note="document.modelContext" />
          </div>
        </section>

        <Arrow label="Access" area="aa" />

        <section className="dg-host">
          <header className="dg-hostbar">
            <Brand src="/diagram/netlify.svg" label="Netlify" />
            <span className="dg-plus">+</span>
            <Brand src="/diagram/nextjs.svg" label="Next.js 16" note="App Router" />
            <span className="dg-plus">+</span>
            <Brand src="/diagram/react.svg" label="React 19" />
            <Brand src="/diagram/typescript.svg" label="TS" />
          </header>

          <div className="dg-tools-reg">
            <p className="kicker">ArenaTools · client component</p>
            <p>
              <code>document.modelContext.registerTool</code> × 18
            </p>
            <p className="dg-flags">
              <span>AbortSignal on unmount</span>
              <span>readOnlyHint</span>
              <span>untrustedContentHint</span>
              <span>clipped output</span>
            </p>
          </div>

          <div className="dg-down" aria-hidden="true">
            ↓
          </div>

          <div className="dg-mid">
            <div className="dg-fn">
              <p className="kicker">Environment</p>
              <ol>
                {FNS.map(([name, hint]) => (
                  <li key={name}>
                    <i className="dg-plus">+</i>
                    <code>{name}</code>
                    <span>{hint}</span>
                  </li>
                ))}
              </ol>
              <p className="dg-foot">
                shaped like OpenSpiel / PettingZoo — a model can write it from what it already
                knows
              </p>
            </div>
            <div className="dg-col">
              <div className="dg-sub-box">
                <header>
                  <Icon glyph="engine" tone="#c9a227" />
                  <p className="kicker">Sandbox</p>
                </header>
                <Brand src="/diagram/daytona.svg" label="Daytona" note="isolated sandbox" />
                <p>runs every game&apos;s code, no network access</p>
              </div>
              <div className="dg-sub-box">
                <header>
                  <Icon glyph="frame" tone="#4a6fc4" />
                  <p className="kicker">Authored table</p>
                </header>
                <p>
                  <code>render()</code> html + css in an iframe
                  <br />
                  no same-origin + no network
                  <br />
                  cannot reach <code>modelContext</code>
                </p>
              </div>
            </div>
          </div>

          <div className="dg-down" aria-hidden="true">
            ↓
          </div>

          <div className="dg-loop">
            <header>
              <Icon glyph="loop" tone="#d0021b" />
              <p className="kicker">Validate · V0–V8 + playouts</p>
            </header>
            <ul className="dg-checks">
              {CHECKS.map(([id, what]) => (
                <li key={id}>
                  <b>{id}</b> {what}
                </li>
              ))}
            </ul>
            <div className="dg-gates">
              <span className="dg-gate bad">
                fail → <code>trace_episode</code> + update ⟲
              </span>
              <span className="dg-gate ok">
                ok → <code>preview_view</code> + publish →
              </span>
            </div>
          </div>

          <div className="dg-down" aria-hidden="true">
            ↓
          </div>

          <div className="dg-mid">
            <div className="dg-match">
              <header>
                <Icon glyph="seats" />
                <p className="kicker">Shared match</p>
              </header>
              <p>
                human seat + agent seat → one <code>step()</code>, one revision
              </p>
            </div>

            <div className="dg-store">
              <header>
                <Icon glyph="store" tone="#0f7a74" />
                <Brand src="/diagram/netlify.svg" label="Netlify Blobs" />
              </header>
              <p>
                store <code>arena</code> — <code>env/</code> · <code>match/</code> · <code>steps/</code>, a key each
              </p>
            </div>
          </div>
        </section>

        <Arrow label="registers" area="at" />

        <section className="dg-box dg-tools">
          <header>
            <Icon glyph="plug" />
            <p className="kicker">WebMCP tools</p>
          </header>
          <p className="dg-sub">
            <code>document.modelContext</code>
          </p>
          {TOOLS.map((block) => (
            <div
              key={block.group}
              className="dg-group"
              style={{ "--tone": block.tone } as React.CSSProperties}
            >
              <p className="kicker">{block.group}</p>
              <ul>
                {block.names.map((name) => (
                  <li key={name}>
                    <Icon glyph={block.glyph} tone={block.tone} />
                    <code>{name}</code>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        <div className="dg-tail" aria-hidden="true">
          ↓
        </div>

        <section className="dg-out">
          <div className="dg-outbody">
            <p className="kicker">
              Output
              <br />
              training dataset
            </p>
            <p className="dg-schema">
              <code>episode</code> match_id + environment + seed + seats + returns
              <br />
              <code>step</code> observation + legal_actions + action + reward + terminal +
              latency_ms
            </p>
            <div className="dg-outside">
              <span>interface: human_ui + webmcp · rationale + confidence on the agent seat</span>
              <Brand src="/diagram/python.svg" label="arena_dataset.py" note="obs, legal, action, reward, next_obs, done" />
              <Brand src="/diagram/github.svg" label="MIT · trajectories CC0" />
            </div>
          </div>
        </section>
      </div>
      <figcaption>
        Every capability the page has, an agent has too. Each reply carries the new observation,
        the legal actions and the revision to quote next.
      </figcaption>
    </figure>
  );
}
