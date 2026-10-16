import type { Environment } from "@/lib/types";
import { envTheme } from "@/lib/theme";
import { EnvIcon } from "./EnvIcon";
import { EnvTabs, type EnvTab } from "./EnvTabs";

export function EnvChrome({
  env,
  current,
  children,
}: {
  env: Pick<Environment, "id" | "name">;
  current: EnvTab;
  kicker?: string;
  children: React.ReactNode;
}) {
  const theme = envTheme(env.id);
  return (
    <main>
      <header className="puzzle-head" style={{ background: theme.color }}>
        <EnvIcon name={theme.icon} />
        <h1>{env.name}</h1>
      </header>
      <EnvTabs id={env.id} current={current} />
      {children}
    </main>
  );
}
