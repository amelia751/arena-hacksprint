#!/usr/bin/env node
/**
 * A host may advertise requestUserInteraction and throw. The wait must
 * still run. Mirrors src/lib/hand-over.ts.
 */
async function withHandOver(run, work) {
  const ask = run?.requestUserInteraction;
  try {
    return typeof ask === "function" ? await ask(work) : await work();
  } catch {
    return work();
  }
}

let bad = 0;
const check = (what, ok, detail) => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail != null ? ` — ${detail}` : ""}`);
};

let n = 0;
const work = async () => {
  n += 1;
  return "held";
};

const plain = await withHandOver({}, work);
check("no hand-over method still runs the wait", plain === "held" && n === 1, `${plain} n=${n}`);

n = 0;
const throws = await withHandOver(
  { requestUserInteraction: () => { throw new Error("requestUserInteraction is not supported here."); } },
  work,
);
check("a throwing shim still runs the wait", throws === "held" && n === 1, `${throws} n=${n}`);

n = 0;
const rejects = await withHandOver(
  { requestUserInteraction: async () => { throw new Error("not supported"); } },
  work,
);
check("a rejecting shim still runs the wait", rejects === "held" && n === 1, `${rejects} n=${n}`);

n = 0;
const real = await withHandOver({ requestUserInteraction: (fn) => fn() }, work);
check("a working hand-over is used once", real === "held" && n === 1, `${real} n=${n}`);

console.log(bad ? `\n${bad} failed` : "\nthe wait survives a broken hand-over");
process.exit(bad ? 1 : 0);
