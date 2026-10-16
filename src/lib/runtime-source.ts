/**
 * The program the Daytona sandbox runs. Shipped as a string so the deployed
 * functions carry it without a file lookup; `sandbox.ts` uploads it on boot.
 *
 * Each environment gets its own `vm` context, keyed by a hash of its source,
 * with string code generation off. Every call has a wall-clock budget. The
 * sandbox itself has no outbound network, so even code that escaped the
 * context would be inside a machine with nothing to reach.
 */
export const RUNTIME_VERSION = "2";

export const RUNTIME_SOURCE = String.raw`
import http from "node:http";
import vm from "node:vm";
import crypto from "node:crypto";

const PORT = Number(process.env.PORT || 4000);
const MAX_REALMS = 64;
const MAX_BODY = 4 * 1024 * 1024;
const realms = new Map();

function message(e) {
  if (e && typeof e === "object" && "message" in e) return String(e.message);
  return String(e);
}

function timedOut(e) {
  return /timed out/i.test(message(e));
}

class GuestError extends Error {
  constructor(msg, fn, stack) {
    super(msg);
    this.fn = fn;
    this.guestStack = stack;
  }
}

function realm(sources) {
  const key = crypto.createHash("sha256").update(JSON.stringify(sources)).digest("hex");
  const hit = realms.get(key);
  if (hit) {
    realms.delete(key);
    realms.set(key, hit);
    return hit;
  }
  const ctx = vm.createContext({}, { codeGeneration: { strings: false, wasm: false } });
  for (const [label, src] of sources) {
    try {
      new vm.Script(src, { filename: label + ".js" }).runInContext(ctx, { timeout: 2000 });
    } catch (e) {
      const why = timedOut(e) ? "interrupted: evaluation ran past 2000ms" : message(e);
      throw new GuestError(label + ": " + why, label, e && e.stack);
    }
  }
  realms.set(key, ctx);
  if (realms.size > MAX_REALMS) realms.delete(realms.keys().next().value);
  return ctx;
}

function call(sources, fn, arg, ms) {
  if (!/^__[a-z_]+$/.test(fn)) throw new GuestError("unknown entry point " + fn, fn);
  const ctx = realm(sources);
  ctx.__arg = JSON.stringify(arg);
  try {
    const started = performance.now();
    const out = vm.runInContext(fn + "(__arg)", ctx, { timeout: ms });
    return { value: JSON.parse(out), ms: performance.now() - started };
  } catch (e) {
    if (timedOut(e)) throw new GuestError("interrupted: " + fn + " ran past " + ms + "ms", fn);
    throw new GuestError(message(e), fn, e && e.stack);
  } finally {
    delete ctx.__arg;
  }
}

function reply(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

http
  .createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      return reply(res, 200, { ok: true, version: process.env.RUNTIME_VERSION, realms: realms.size, node: process.version });
    }
    if (req.method !== "POST" || req.url !== "/call") return reply(res, 404, { ok: false });
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) req.destroy();
      else chunks.push(c);
    });
    req.on("end", () => {
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return reply(res, 400, { ok: false, error: { message: "body is not JSON" } });
      }
      try {
        const out = call(body.sources, body.fn, body.arg, Math.min(Number(body.ms) || 4000, 60000));
        reply(res, 200, { ok: true, value: out.value, ms: out.ms });
      } catch (e) {
        reply(res, 200, {
          ok: false,
          error: { message: message(e), fn: e && e.fn, stack: e && e.guestStack },
        });
      }
    });
  })
  .listen(PORT, "0.0.0.0");
`;
