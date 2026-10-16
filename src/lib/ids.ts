import { createHash, randomBytes } from "crypto";
import type { EnvCode } from "./types";

export function nid(prefix: string): string {
  return `${prefix}_${randomBytes(4).toString("hex")}`;
}

export function codeHash(code: EnvCode): string {
  const body = ["init", "legal_actions", "observe", "step", "render"]
    .map((k) => `${k}\n${code[k as keyof EnvCode]}\n`)
    .join("");
  return "sha256:" + createHash("sha256").update(body).digest("hex");
}

export function now(): string {
  return new Date().toISOString();
}
