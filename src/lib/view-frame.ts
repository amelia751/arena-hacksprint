import { sanitizeView, type AuthoredView } from "./view";
import { project, type Projection } from "./view-project";

export type SnapshotOptions = { legal?: string[]; varied?: boolean };

export type ViewHandle = {
  snapshot: (opts?: SnapshotOptions) => Promise<Projection>;
  setLegal: (legal: string[], disabled: boolean) => void;
  update: (view: AuthoredView) => void;
  destroy: () => void;
};

const FRAME_CSS = `
html,body{margin:0;padding:0;background:transparent;color:#1c1814;
  font-family:ui-sans-serif,system-ui,-apple-system,sans-serif}
body{display:flex;justify-content:center;align-items:flex-start}
#arena-root{width:max-content;max-width:100%}
*{box-sizing:border-box}
button{font:inherit;cursor:pointer}
button:disabled,[data-action][aria-disabled="true"]{cursor:default}
[data-action][aria-disabled="true"]{opacity:.4}
`;

// The frame is an opaque origin with no network reach, so this bridge is the
// only channel out of it.
const BRIDGE = `
const project = __PROJECT__;
const parentWin = window.parent;
function post(msg) { parentWin.postMessage(Object.assign({ __arena: true }, msg), "*"); }
function measure() {
  const root = document.getElementById("arena-root");
  if (!root) return;
  const r = root.getBoundingClientRect();
  post({
    kind: "size",
    width: Math.ceil(Math.max(root.scrollWidth, r.width)),
    height: Math.ceil(Math.max(root.scrollHeight, r.height)),
  });
}
document.addEventListener("click", (e) => {
  const el = e.target && e.target.closest ? e.target.closest("[data-action]") : null;
  if (!el) return;
  e.preventDefault();
  if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") return;
  post({ kind: "action", action: el.getAttribute("data-action") });
});
window.addEventListener("message", (e) => {
  const d = e.data;
  if (!d || d.__arena !== true) return;
  if (d.kind === "snapshot") {
    let result;
    try { result = project(d.opts || {}); }
    catch (err) { result = { picture: "(projection failed: " + err.message + ")", controls: [], actions: [], size: { width: 0, height: 0 }, warnings: ["projection failed"] }; }
    post({ kind: "snapshot:result", id: d.id, result });
    return;
  }
  if (d.kind === "legal") {
    const legal = d.legal || [];
    // An empty legal list on an enabled board used to grey out every control,
    // which is how a person ended up staring at "Your turn" with nothing to
    // click. If we do not know the mask, leave the buttons up and let the
    // server refuse a bad move.
    const open = !d.disabled && legal.length === 0;
    for (const el of document.querySelectorAll("[data-action]")) {
      const off = !open && (d.disabled || legal.indexOf(el.getAttribute("data-action")) < 0);
      if (off) { el.setAttribute("disabled", ""); el.setAttribute("aria-disabled", "true"); }
      else { el.removeAttribute("disabled"); el.removeAttribute("aria-disabled"); }
    }
    measure();
    return;
  }
  if (d.kind === "render") {
    document.getElementById("arena-style").textContent = d.css || "";
    document.getElementById("arena-root").innerHTML = d.html || "";
    requestAnimationFrame(measure);
  }
});
if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
requestAnimationFrame(() => requestAnimationFrame(measure));
post({ kind: "ready" });
`;

export function buildSrcdoc(view: AuthoredView): string {
  const clean = sanitizeView(view);
  const bridge = BRIDGE.replace("__PROJECT__", String(project));
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'">
<style>${FRAME_CSS}</style>
<style id="arena-style">${clean.view.css}</style>
</head><body><div id="arena-root">${clean.view.html}</div>
<script>${bridge}</script></body></html>`;
}

type MountOptions = {
  onAction?: (id: string) => void;
  onSize?: (size: { width: number; height: number }) => void;
  width?: number;
};

/** Preview and the live table lay out in the same box, so what the agent was
 *  shown is what the person gets. */
const MEASURE_WIDTH = 760;

export function mountView(
  host: HTMLElement,
  view: AuthoredView,
  opts: MountOptions = {},
): ViewHandle {
  const frame = document.createElement("iframe");
  // Opaque origin: scripts may run but cannot reach this document, its storage,
  // or document.modelContext. No allow-same-origin, ever.
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.setAttribute("title", "Game table");
  frame.style.cssText = `display:block;border:0;width:${opts.width ?? MEASURE_WIDTH}px;height:120px;overflow:hidden;color-scheme:light`;
  frame.srcdoc = buildSrcdoc(view);
  host.appendChild(frame);

  let ready = false;
  const queue: Array<Record<string, unknown>> = [];
  const pending = new Map<number, (p: Projection) => void>();
  let seq = 0;

  const send = (msg: Record<string, unknown>) => {
    const win = frame.contentWindow;
    if (!ready || !win) queue.push(msg);
    else win.postMessage({ __arena: true, ...msg }, "*");
  };

  const onMessage = (e: MessageEvent) => {
    if (!frame.contentWindow || e.source !== frame.contentWindow) return;
    const d = e.data;
    if (!d || d.__arena !== true) return;
    if (d.kind === "ready") {
      ready = true;
      while (queue.length) send(queue.shift()!);
      return;
    }
    if (d.kind === "size") {
      const h = Math.max(40, d.height || 0);
      frame.style.height = `${h}px`;
      if (opts.width == null && d.width) frame.style.width = `${d.width}px`;
      opts.onSize?.({ width: d.width, height: h });
      return;
    }
    if (d.kind === "action") {
      opts.onAction?.(String(d.action));
      return;
    }
    if (d.kind === "snapshot:result") {
      const resolve = pending.get(d.id);
      if (resolve) {
        pending.delete(d.id);
        resolve(d.result as Projection);
      }
    }
  };
  window.addEventListener("message", onMessage);

  return {
    snapshot(o) {
      const id = ++seq;
      return new Promise<Projection>((resolve) => {
        const timer = setTimeout(() => {
          if (pending.delete(id)) {
            resolve({
              picture: "(the table did not answer in time)",
              controls: [],
              actions: [],
              size: { width: 0, height: 0 },
              problems: ["the table did not respond — remount it and try again"],
              notes: [],
            });
          }
        }, 2500);
        pending.set(id, (p) => {
          clearTimeout(timer);
          resolve(p);
        });
        send({ kind: "snapshot", id, opts: { legal: o?.legal || [], varied: !!o?.varied } });
      });
    },
    setLegal(legal, disabled) {
      send({ kind: "legal", legal, disabled });
    },
    update(next) {
      const clean = sanitizeView(next);
      send({ kind: "render", html: clean.view.html, css: clean.view.css });
    },
    destroy() {
      window.removeEventListener("message", onMessage);
      frame.remove();
    },
  };
}

/** Mount offscreen, snapshot once, tear down. Used by preview_view. */
export async function snapshotOffscreen(
  view: AuthoredView,
  opts?: SnapshotOptions,
): Promise<Projection> {
  const host = document.createElement("div");
  host.style.cssText =
    "position:fixed;left:-10000px;top:0;width:760px;opacity:0;pointer-events:none;z-index:-1";
  document.body.appendChild(host);
  const handle = mountView(host, view, { width: MEASURE_WIDTH });
  try {
    await new Promise((r) => setTimeout(r, 60));
    // Show it the way a player would see it, with illegal controls greyed out.
    if (opts?.legal) handle.setLegal(opts.legal, false);
    return await handle.snapshot(opts);
  } finally {
    handle.destroy();
    host.remove();
  }
}
