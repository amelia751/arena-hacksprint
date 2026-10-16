export type AuthoredView = {
  html: string;
  css: string;
};

export type ParsedRender =
  | { kind: "html"; view: AuthoredView; errors: string[] }
  | { kind: "tree"; tree: unknown; errors: string[] }
  | { kind: "invalid"; errors: string[] };

const FORBIDDEN_TAGS =
  /<\/?(?:script|iframe|object|embed|link|meta|base|form|textarea|applet|svg|math|frame|frameset|template|noscript)\b[^>]*>/gi;

const EVENT_ATTR = /\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const BAD_URL = /\s(?:href|src|xlink:href|formaction)\s*=\s*(?:"(?!#|data:image\/)[^"]*"|'(?!#|data:image\/)[^']*')/gi;
const COMMENT = /<!--[\s\S]*?-->/g;

const CSS_IMPORT = /@import\b[^;]*;?/gi;
const CSS_URL = /url\s*\(\s*[^)]*\)/gi;
const CSS_EXPR = /expression\s*\(/gi;
const CSS_BIND = /(?:behavior|-moz-binding)\s*:[^;]+;?/gi;

export function parseRender(raw: unknown): ParsedRender {
  if (typeof raw === "string") {
    if (!raw.trim()) return { kind: "invalid", errors: ["render returned an empty string"] };
    return { kind: "html", view: { html: raw, css: "" }, errors: [] };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { kind: "invalid", errors: ["render must return { html, css }"] };
  }
  const row = raw as { html?: unknown; css?: unknown; type?: unknown };
  if (typeof row.html === "string") {
    return {
      kind: "html",
      view: { html: row.html, css: typeof row.css === "string" ? row.css : "" },
      errors: [],
    };
  }
  if (typeof row.type === "string") {
    return { kind: "tree", tree: raw, errors: [] };
  }
  return {
    kind: "invalid",
    errors: ["render must return { html, css } — html is required"],
  };
}

export function sanitizeHtml(html: string): { html: string; stripped: string[] } {
  const stripped: string[] = [];
  let out = html.replace(COMMENT, () => {
    stripped.push("comment");
    return "";
  });
  out = out.replace(FORBIDDEN_TAGS, (m) => {
    stripped.push(tagName(m));
    return "";
  });
  out = out.replace(EVENT_ATTR, () => {
    stripped.push("event-handler");
    return "";
  });
  out = out.replace(BAD_URL, () => {
    stripped.push("external-url");
    return "";
  });
  out = out.replace(/javascript:/gi, () => {
    stripped.push("javascript-url");
    return "";
  });
  return { html: out, stripped: unique(stripped) };
}

export function sanitizeCss(css: string): { css: string; stripped: string[] } {
  const stripped: string[] = [];
  let out = css.replace(CSS_IMPORT, () => {
    stripped.push("@import");
    return "";
  });
  out = out.replace(CSS_URL, () => {
    stripped.push("url()");
    return "";
  });
  out = out.replace(CSS_EXPR, () => {
    stripped.push("expression()");
    return "";
  });
  out = out.replace(CSS_BIND, () => {
    stripped.push("behavior");
    return "";
  });
  return { css: out, stripped: unique(stripped) };
}

export function sanitizeView(view: AuthoredView): {
  view: AuthoredView;
  stripped: string[];
} {
  const h = sanitizeHtml(view.html);
  const c = sanitizeCss(view.css);
  return {
    view: { html: h.html, css: c.css },
    stripped: unique([...h.stripped, ...c.stripped]),
  };
}

export function listDataActions(html: string): string[] {
  const found = new Set<string>();
  const re = /data-action\s*=\s*(?:"([^"]+)"|'([^']+)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const id = m[1] || m[2];
    if (id) found.add(id);
  }
  return [...found];
}

export function validateAuthoredView(view: AuthoredView, legal?: string[]): string[] {
  const errors: string[] = [];
  const clean = sanitizeView(view);
  if (!clean.view.html.trim()) errors.push("render.html is empty after sanitizing");
  if (clean.view.html.length > 40_000) errors.push("render.html is over 40k characters");
  if (clean.view.css.length > 20_000) errors.push("render.css is over 20k characters");
  const actions = listDataActions(clean.view.html);
  if (legal && legal.length && actions.length === 0) {
    errors.push(
      "html has no data-action attributes. Put data-action=\"<legal id>\" on clickable elements (e.g. data-action=\"col_3\").",
    );
  }
  return errors;
}

export function fallbackView(observation: unknown, legal: string[]): AuthoredView {
  const buttons = legal
    .map((id) => {
      const safe = escapeHtml(id);
      return `<button type="button" data-action="${safe}" aria-label="${safe}">${safe}</button>`;
    })
    .join("");
  return {
    html: `<div class="fb"><p>render() did not return { html, css }.</p><pre>${escapeHtml(JSON.stringify(observation, null, 2))}</pre><div class="fb-moves">${buttons}</div></div>`,
    css: `.fb{max-width:28rem;color:#6e675c;font-size:14px}.fb pre{white-space:pre-wrap;font-size:12px}.fb-moves{display:flex;flex-wrap:wrap;gap:8px}.fb-moves button{background:#1c1814;color:#f4efe6;border:0;border-radius:999px;padding:6px 14px}`,
  };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function tagName(chunk: string): string {
  const m = chunk.match(/<\/?([a-z0-9]+)/i);
  return m ? m[1].toLowerCase() : "tag";
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}
