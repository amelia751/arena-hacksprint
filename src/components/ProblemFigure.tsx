import { Icon } from "@/components/diagram-kit";

const TRAITS = [
  "partially observable",
  "competitive",
  "multi-agent",
  "sequential",
  "non-stationary",
];

const ATTEMPTS: Array<{
  glyph: "seats" | "camera" | "server";
  tone: string;
  title: string;
  gives: string;
  missing: string;
}> = [
  {
    glyph: "seats",
    tone: "#4a6fc4",
    title: "Agent-versus-agent ladder",
    gives: "Volume. A shared simulator, a typed observation, an action index.",
    missing: "No person in either seat. The opponent never surprises the model.",
  },
  {
    glyph: "camera",
    tone: "#8e4fa0",
    title: "Screenshot / browser-use agent",
    gives: "It can sit on a human page and click what it sees.",
    missing: "No typed observation, no legal-action mask. It guesses at buttons.",
  },
  {
    glyph: "server",
    tone: "#0f7a74",
    title: "Server-side MCP",
    gives: "It can write environment code all day.",
    missing: "It writes in the dark — no board, no live match, no person across it.",
  },
];

export function ProblemFigure() {
  return (
    <figure className="diagram">
      <div className="sl">
        <section className="sl-head">
          <p className="kicker">The problem</p>
          <h2>
            Human-versus-agent games have no training data for a partially observable,
            competitive, multi-agent, sequential decision-making problem.
          </h2>
          <div className="sl-traits">
            {TRAITS.map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>
          <p className="sl-lead">
            Game-agent research needs diverse interactive trajectories. A person thinking across
            the table is the opponent that actually moves the distribution — and that tape is
            almost never collected, because the two seats do not share an interface.
          </p>
        </section>

        <div className="sl-versus">
          <section className="sl-card sl-human">
            <header>
              <Icon glyph="person" />
              <p className="kicker">Human</p>
            </header>
            <p className="sl-want">wants a board</p>
            <ul>
              <li>
                <Icon glyph="board" />
                pixels, a layout, a thing to look at
              </li>
              <li>
                <Icon glyph="play" />
                click the piece, see what happened
              </li>
            </ul>
            <p className="sl-tag">a UI</p>
          </section>

          <div className="sl-join sl-join-bad" aria-hidden="true">
            <Icon glyph="ban" />
            <span>they do not meet</span>
          </div>

          <section className="sl-card sl-agent">
            <header>
              <Icon glyph="plug" />
              <p className="kicker">Agent</p>
            </header>
            <p className="sl-want">wants a typed observation</p>
            <ul>
              <li>
                <Icon glyph="mask" />
                a legal-action mask, not a screenshot
              </li>
              <li>
                <Icon glyph="loop" />a <code>step()</code> that returns reward and terminal
              </li>
            </ul>
            <p className="sl-tag">a gym API</p>
          </section>
        </div>

        <div className="sl-cost">
          <b>Two products, two states, no shared match.</b>
          <span>
            A ladder has no person. A screenshot has no mask. Neither writes a trajectory that
            says which side was human.
          </span>
          <em>→ no human-versus-agent dataset</em>
        </div>

        <div className="sl-attempts">
          {ATTEMPTS.map((a) => (
            <section key={a.title} className="sl-attempt">
              <header>
                <Icon glyph={a.glyph} tone={a.tone} />
                <p className="kicker">{a.title}</p>
              </header>
              <p className="sl-gives">{a.gives}</p>
              <p className="sl-missing">
                <Icon glyph="ban" tone="#d0021b" />
                {a.missing}
              </p>
            </section>
          ))}
        </div>
      </div>
      <figcaption>
        Every route to the data drops one of the two things that make it worth collecting: a
        person in a seat, or a typed observation with a legal-action mask.
      </figcaption>
    </figure>
  );
}
