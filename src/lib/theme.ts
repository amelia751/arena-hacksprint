export type EnvIconName =
  | "grid"
  | "discs"
  | "cards"
  | "star"
  | "hex"
  | "diamond"
  | "tiles"
  | "plus";

export type EnvTheme = {
  color: string;
  icon: EnvIconName;
};

const PALETTE: EnvTheme[] = [
  { color: "#f9df6d", icon: "star" },
  { color: "#a0c35a", icon: "hex" },
  { color: "#b0c4ef", icon: "diamond" },
  { color: "#ba81c5", icon: "plus" },
  { color: "#7ec8c3", icon: "tiles" },
  { color: "#e3e3e1", icon: "star" },
];

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

export function envTheme(id: string): EnvTheme {
  return PALETTE[hashId(id) % PALETTE.length];
}

export function cardBlurb(env: { id: string; description: string }): string {
  const first = env.description.split(/(?<=[.!?])\s/)[0]?.trim() || env.description.trim();
  if (!first) return "Play this one.";
  return first.length > 72 ? `${first.slice(0, 69)}…` : first;
}
