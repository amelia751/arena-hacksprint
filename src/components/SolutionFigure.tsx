import { Brand, Icon } from "@/components/diagram-kit";

const HUMAN_TOOLS = [
  ["Table", "click data-action"],
  ["Inspect", "walk a deal, pin a seat"],
  ["Data", "schema + recorded step"],
];

const AGENT_TOOLS = [
  ["get_observation", "per-seat view + legal actions"],
  ["take_action", "one legal id + expected_revision"],
  ["wait_for_turn", "block until the human moves"],
];

export function SolutionFigure() {
  return (
    <figure className="diagram">
      <div className="sl">
        <section className="sl-head sl-head-good">
          <p className="kicker">The join</p>
          <h2>
            WebMCP puts both seats on one live page, against one <code>step()</code>.
          </h2>
          <div className="sl-traits sl-traits-good">
            <span>one document</span>
            <span>two interfaces</span>
            <span>one match state</span>
            <span>one dataset</span>
          </div>
          <p className="sl-lead">
            The tools are registered on the page the person is looking at, so a tool call and a
            click land on the same match. Nothing has to be integrated, mirrored or replayed.
          </p>
        </section>

        <div className="sl-versus">
          <section className="sl-card sl-human">
            <header>
              <Icon glyph="person" />
              <p className="kicker">Human</p>
            </header>
            <p className="sl-want">plays the board</p>
            <ul>
              {HUMAN_TOOLS.map(([name, note]) => (
                <li key={name}>
                  <Icon glyph="board" />
                  <b>{name}</b>
                  {note}
                </li>
              ))}
            </ul>
            <p className="sl-tag">the rendered table</p>
          </section>

          <div className="sl-join sl-join-good">
            <Icon glyph="link" />
            <span>
              <code>document.modelContext</code>
            </span>
            <div className="sl-clients">
              <Brand src="/diagram/webmcp.svg" label="WebMCP" />
              <Brand src="/diagram/daytona.svg" label="Daytona" />
            </div>
          </div>

          <section className="sl-card sl-agent">
            <header>
              <Icon glyph="plug" />
              <p className="kicker">Agent</p>
            </header>
            <p className="sl-want">calls tools on that same page</p>
            <ul>
              {AGENT_TOOLS.map(([name, note]) => (
                <li key={name}>
                  <Icon glyph="play" />
                  <b>
                    <code>{name}</code>
                  </b>
                  {note}
                </li>
              ))}
            </ul>
            <p className="sl-tag">18 registered tools</p>
          </section>
        </div>

        <div className="sl-down" aria-hidden="true">
          ↓
        </div>

        <div className="sl-match">
          <Icon glyph="seats" />
          <b>one match</b>
          <span>
            one revision · one <code>step()</code> · every write repaints the table before the
            tool returns
          </span>
        </div>

        <div className="sl-down" aria-hidden="true">
          ↓
        </div>

        <div className="sl-out">
          <p className="kicker">
            Output
            <br />
            training dataset
          </p>
          <p className="sl-schema">
            <code>episode</code> match_id + environment + seed + seats + returns
            <br />
            <code>step</code> observation + legal_actions + action + reward + terminal +
            latency_ms
          </p>
          <div className="sl-outside">
            <span>
              <Icon glyph="file" />
              interface: <b>human_ui</b> | <b>webmcp</b> — a click and a tool call stay
              distinguishable
            </span>
            <Brand
              src="/diagram/python.svg"
              label="arena_dataset.py"
              note="obs, legal, action, reward, next_obs, done"
            />
          </div>
        </div>
      </div>
      <figcaption>
        The same loop the person uses is the loop the agent gets. Every capability on the page
        has a tool, and every tool returns enough state for the agent to decide the next call.
      </figcaption>
    </figure>
  );
}
