import type { Environment } from "@/lib/types";
import { cardBlurb, envTheme } from "@/lib/theme";
import { EnvIcon } from "./EnvIcon";

export function EnvCard({ env }: { env: Pick<Environment, "id" | "name" | "description"> }) {
  const theme = envTheme(env.id);

  return (
    <article className="game-card">
      <div className="game-card-top" style={{ background: theme.color }}>
        <EnvIcon name={theme.icon} />
        <h2>{env.name}</h2>
      </div>
      <div className="game-card-body">
        <p>{cardBlurb(env)}</p>
        <div className="card-actions">
          <a className="pill" href={`/e/${env.id}`}>
            Play
          </a>
          <a className="pill quiet" href={`/e/${env.id}/inspect`}>
            Inspect
          </a>
        </div>
      </div>
    </article>
  );
}
