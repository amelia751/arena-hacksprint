export type ProjectOptions = {
  legal?: string[];
  /** True when the caller knows the position is not the opening one, so a
   *  uniform board means the markup is ignoring the observation. */
  varied?: boolean;
};

export type Control = {
  action: string;
  name: string;
  tag: string;
  w: number;
  h: number;
  enabled: boolean;
};

export type Projection = {
  picture: string;
  controls: Control[];
  actions: string[];
  size: { width: number; height: number };
  /** Things that stop the table working. */
  problems: string[];
  /** Things worth improving that do not block play. */
  notes: string[];
};

/**
 * Runs inside the view frame and describes what actually painted: repeated
 * same-size boxes become a character grid, everything else becomes positioned
 * text. Serialized with String(project) and injected into the frame, so it must
 * stay self-contained — no imports, no closure references.
 */
export function project(options?: ProjectOptions): Projection {
  const opts = options || {};
  const legal: string[] = opts.legal || [];
  const problems: string[] = [];
  const notes: string[] = [];

  type Node = {
    el: Element;
    r: DOMRect;
    text: string;
    /** What a person can actually read on it, ignoring anything only a screen reader hears. */
    shown: string;
    name: string;
    action: string | null;
    paint: string | null;
    leaf: boolean;
    round: boolean;
    disabled: boolean;
    spun: number;
    clips: boolean;
  };

  // Authored text lands inside a report the agent reads as prose, so it must not be able to
  // carry line breaks or run long enough to impersonate the report's own sections.
  function squash(s: string): string {
    const t = String(s || "").replace(/\s+/g, " ").trim();
    return t.length > 80 ? t.slice(0, 80) + "…" : t;
  }

  function ownText(el: Element): string {
    const out: string[] = [];
    el.childNodes.forEach((n) => {
      if (n.nodeType === 3) {
        const t = squash(n.textContent || "");
        if (t) out.push(t);
      }
    });
    return out.join(" ");
  }

  function parseColor(v: string): { r: number; g: number; b: number; a: number } | null {
    const m = String(v).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(",").map((x) => parseFloat(x));
    if (p.length < 3 || p.some((x) => isNaN(x))) return null;
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }

  function toHex(c: { r: number; g: number; b: number }): string {
    const h = (v: number) => {
      const s = Math.round(v).toString(16);
      return s.length < 2 ? "0" + s : s;
    };
    return "#" + h(c.r) + h(c.g) + h(c.b);
  }

  function paintOf(el: Element): string | null {
    const cs = getComputedStyle(el);
    const img = cs.backgroundImage;
    if (img && img !== "none") {
      const found = img.match(/#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)/);
      if (found) {
        const raw = found[0];
        if (raw.charAt(0) === "#") return raw.toLowerCase().slice(0, 7);
        const c = parseColor(raw);
        return c ? toHex(c) : "img";
      }
      return "img";
    }
    const bg = parseColor(cs.backgroundColor);
    if (bg && bg.a > 0.05) return toHex(bg);
    return null;
  }

  /** A ::before/::after can be the whole visible mark on a control, and it is in no child list. */
  function pseudoPaints(el: Element): boolean {
    for (const which of ["::before", "::after"]) {
      const cs = getComputedStyle(el, which);
      const content = cs.content;
      if (!content || content === "none" || content === "normal") continue;
      if (content !== '""' && content !== "''") return true;
      if (cs.backgroundImage && cs.backgroundImage !== "none") return true;
      const bg = parseColor(cs.backgroundColor);
      if (bg && bg.a > 0.05) return true;
      for (const side of ["borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth"]) {
        if (parseFloat((cs as unknown as Record<string, string>)[side]) > 0) return true;
      }
    }
    return false;
  }

  function luminance(c: { r: number; g: number; b: number }): number {
    const f = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }

  const nodes: Node[] = [];
  const all = document.body ? document.body.querySelectorAll("*") : [];
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    const tag = el.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEMPLATE") continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.05) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const radius = parseFloat(cs.borderTopLeftRadius) || 0;
    // A rotated element is a deliberate choice everywhere except on text, where
    // it is usually a card meant to face the other player and ends up unreadable.
    const m = cs.transform && cs.transform !== "none" ? cs.transform.match(/matrix\(([^)]+)\)/) : null;
    let spun = 0;
    if (m) {
      const p = m[1].split(",").map(parseFloat);
      if (p.length >= 4) spun = Math.round((Math.atan2(p[1], p[0]) * 180) / Math.PI);
    }
    nodes.push({
      el,
      r,
      text: ownText(el),
      shown: squash(el.textContent || ""),
      name: squash(el.getAttribute("aria-label") || el.textContent || ""),
      action: el.getAttribute("data-action"),
      paint: paintOf(el),
      leaf: el.children.length === 0,
      round: radius >= Math.min(r.width, r.height) / 2 - 1,
      disabled: el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true",
      spun,
      clips: cs.overflow !== "visible",
    });
  }

  // --- repeated same-size leaves become a grid -----------------------------
  type Grid = { members: Node[]; cols: number[]; rows: number[]; w: number; h: number };

  function axis(values: number[], tol: number): number[] {
    const sorted = values.slice().sort((a, b) => a - b);
    const out: number[] = [];
    for (const v of sorted) {
      if (!out.length || v - out[out.length - 1] > tol) out.push(v);
    }
    return out;
  }

  const buckets: Record<string, Node[]> = {};
  for (const n of nodes) {
    // A square holding a piece is not a leaf. Taking leaves only meant every
    // board that nests its pieces projected as an empty grid.
    if (n.el.querySelectorAll("*").length > 4) continue;
    const key = Math.round(n.r.width / 2) * 2 + "x" + Math.round(n.r.height / 2) * 2;
    (buckets[key] = buckets[key] || []).push(n);
  }

  const grids: Grid[] = [];
  const claimed = new Set<Element>();
  const areaOf = (key: string) => {
    const parts = key.split("x");
    return Number(parts[0]) * Number(parts[1]);
  };
  // Bigger boxes first on a tie, so the square wins over the piece sitting in it.
  const bucketKeys = Object.keys(buckets).sort(
    (a, b) => buckets[b].length - buckets[a].length || areaOf(b) - areaOf(a),
  );
  for (const key of bucketKeys) {
    const members = buckets[key].filter((n) => !claimed.has(n.el));
    if (members.length < 6) continue;
    const tol = Math.max(4, members[0].r.width / 3);
    const cols = axis(members.map((n) => n.r.left + n.r.width / 2), tol);
    const rows = axis(members.map((n) => n.r.top + n.r.height / 2), Math.max(4, members[0].r.height / 3));
    if (cols.length < 2 || rows.length < 2) continue;
    if (cols.length * rows.length > members.length * 1.5) continue;
    for (const n of members) {
      claimed.add(n.el);
      // The piece inside a square belongs to that square, not to a grid of its own.
      const inside = n.el.querySelectorAll("*");
      for (let i = 0; i < inside.length; i++) claimed.add(inside[i]);
    }
    grids.push({ members, cols, rows, w: members[0].r.width, h: members[0].r.height });
  }

  const lines: string[] = [];

  function nearest(values: number[], v: number): number {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < values.length; i++) {
      const d = Math.abs(values[i] - v);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  for (const g of grids) {
    const cells: (Node | null)[][] = [];
    for (let r = 0; r < g.rows.length; r++) cells.push(new Array(g.cols.length).fill(null));
    for (const n of g.members) {
      const c = nearest(g.cols, n.r.left + n.r.width / 2);
      const r = nearest(g.rows, n.r.top + n.r.height / 2);
      cells[r][c] = n;
    }

    const tally: Record<string, number> = {};
    /** The disc drawn inside a square is what tells two squares apart. */
    const innerPaint = (n: Node) => {
      const inside = n.el.querySelectorAll("*");
      let best: string | null = null;
      let bestArea = 0;
      for (let i = 0; i < inside.length; i++) {
        const p = paintOf(inside[i]);
        if (!p) continue;
        const b = inside[i].getBoundingClientRect();
        if (b.width * b.height > bestArea) {
          bestArea = b.width * b.height;
          best = p;
        }
      }
      return best;
    };
    const keyOf = (n: Node | null) => {
      if (!n) return "gap";
      if (n.shown) return "t:" + n.shown;
      return "c:" + (innerPaint(n) || n.paint || "none");
    };
    for (const row of cells) for (const n of row) tally[keyOf(n)] = (tally[keyOf(n)] || 0) + 1;

    const ranked = Object.keys(tally).sort((a, b) => tally[b] - tally[a]);
    const glyph: Record<string, string> = {};
    const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    let next = 0;
    for (const k of ranked) {
      if (k === "gap") glyph[k] = " ";
      else if (k === ranked[0]) glyph[k] = ".";
      else if (k.indexOf("t:") === 0 && k.length === 3) glyph[k] = k.charAt(2);
      else glyph[k] = letters.charAt(next++ % letters.length);
    }

    lines.push(
      `grid ${g.cols.length} cols x ${g.rows.length} rows, cell ${Math.round(g.w)}x${Math.round(g.h)}px:`,
    );
    for (const row of cells) lines.push("  " + row.map((n) => glyph[keyOf(n)]).join(" "));
    const legend = ranked
      .filter((k) => k !== "gap")
      .map((k) => {
        const label = k.indexOf("t:") === 0 ? '"' + k.slice(2) + '"' : k.slice(2);
        return `${glyph[k]}=${label} x${tally[k]}`;
      });
    if (tally["gap"]) legend.push(`(blank)=no element x${tally["gap"]}`);
    lines.push("  legend: " + legend.join("  "));

    // A hole in the grid is itself something a person can see, so a board with
    // gaps is not a board that ignored the position.
    const distinct = ranked.filter((k) => k !== "gap").length + (tally["gap"] ? 1 : 0);
    if (distinct <= 1 && opts.varied) {
      problems.push(
        `every cell of the ${g.cols.length}x${g.rows.length} grid looks identical even though pieces have been played — render() is not reading the observation into the cells`,
      );
    }
  }

  // --- everything else, in reading order ----------------------------------
  const flow = nodes.filter((n) => {
    if (claimed.has(n.el)) return false;
    if (n.action) return true;
    if (n.text) return true;
    return n.leaf && !!n.paint;
  });

  const rowTol = 10;
  flow.sort((a, b) => {
    const dy = a.r.top - b.r.top;
    if (Math.abs(dy) > rowTol) return dy;
    return a.r.left - b.r.left;
  });

  const flowLines: string[] = [];
  let current: Node[] = [];
  let currentTop = -1e9;
  const flush = () => {
    if (!current.length) return;
    const parts = current.map((n) => {
      if (n.action) {
        // An aria-label paints nothing, so crediting it here would describe a
        // button the person cannot actually read.
        const label = n.shown || (pseudoPaints(n.el) ? "(mark, no words)" : "(blank)");
        return `[${label}${n.disabled ? " (disabled)" : ""} -> ${n.action}]`;
      }
      if (n.text) return n.text;
      return `<${n.round ? "disc" : "box"} ${n.paint} ${Math.round(n.r.width)}x${Math.round(n.r.height)}>`;
    });
    flowLines.push("  " + parts.join("  "));
    current = [];
  };
  for (const n of flow) {
    if (n.r.top - currentTop > rowTol) {
      flush();
      currentTop = n.r.top;
    }
    current.push(n);
  }
  flush();
  if (flowLines.length) {
    lines.push(grids.length ? "around it:" : "layout:");
    for (const l of flowLines.slice(0, 40)) lines.push(l);
    if (flowLines.length > 40) lines.push(`  … ${flowLines.length - 40} more rows`);
  }

  // --- controls and their problems ----------------------------------------
  const controls: Control[] = [];
  const seen: Record<string, boolean> = {};
  const blanks: Node[] = [];
  for (const n of nodes) {
    if (!n.action) continue;
    // Cells of a board are meant to be empty until something is played. A control
    // standing on its own is not — if it shows nothing, it reads as a grey box.
    if (!n.shown && n.leaf && !claimed.has(n.el) && !pseudoPaints(n.el)) blanks.push(n);
    controls.push({
      action: n.action,
      name: n.name || "",
      tag: n.el.tagName.toLowerCase(),
      w: Math.round(n.r.width),
      h: Math.round(n.r.height),
      enabled: !n.disabled,
    });
    seen[n.action] = true;
    if (n.el.tagName !== "BUTTON") {
      problems.push(
        `data-action="${n.action}" is a <${n.el.tagName.toLowerCase()}> — use <button aria-label="…"> so it is focusable and has a name`,
      );
    }
    if (!n.name) problems.push(`data-action="${n.action}" has no text or aria-label`);
    if (n.r.width < 24 || n.r.height < 16) {
      problems.push(
        `data-action="${n.action}" is only ${Math.round(n.r.width)}x${Math.round(n.r.height)}px — too small to click reliably`,
      );
    }
  }
  if (!controls.length) {
    problems.push('nothing painted a data-action. Put data-action="<legal id>" on clickable elements.');
  }
  // Nothing else in this pass ever looks at how big a control is, so a table can
  // be perfectly correct and still be a row of slivers nobody can hit.
  const small = controls.filter((c) => c.enabled && c.h > 0 && c.h < 32);
  if (small.length) {
    const worst = small.reduce((a, b) => (a.h < b.h ? a : b));
    const line = `${small.length === 1 ? `${worst.action} is` : `${small.length} controls are`} under 32px tall (${worst.action} is ${worst.h}px) — give them height or padding so a person can hit them`;
    if (worst.h < 24) problems.push(line);
    else notes.push(line);
  }
  if (blanks.length) {
    // Colour can stand in for a label — but only while the controls differ.
    const alike: Record<string, Node[]> = {};
    for (const n of blanks) {
      const key = (n.paint || "none") + " " + Math.round(n.r.width) + "x" + Math.round(n.r.height);
      (alike[key] = alike[key] || []).push(n);
    }
    const worst = Object.keys(alike).sort((a, b) => alike[b].length - alike[a].length)[0];
    const group = alike[worst];
    const hint = blanks.some((n) => n.name)
      ? "an aria-label paints nothing — put the words inside the button as well"
      : "give each one text a person can read";
    const ids = group.map((n) => n.action).join(", ");
    const swatch = group[0].paint;
    if (group.length > 1) {
      problems.push(
        swatch
          ? `${group.length} controls show no text (${ids}) — a person sees ${group.length} identical ${swatch} boxes and cannot tell them apart: ${hint}`
          : `${group.length} controls paint nothing at all (${ids}) — no text and no background, so a person cannot see there is anything to click: ${hint}`,
      );
    } else {
      notes.push(
        swatch
          ? `${ids} shows no text a person can read: ${hint}`
          : `${ids} paints nothing at all — no text and no background: ${hint}`,
      );
    }
  }
  for (const id of legal) {
    if (!seen[id]) problems.push(`legal action "${id}" has no data-action in the markup`);
  }

  // --- layout problems -----------------------------------------------------
  const root = document.getElementById("arena-root") || document.body;
  const rootRect = root ? root.getBoundingClientRect() : null;
  const width = root ? Math.round(Math.max(root.scrollWidth, rootRect ? rootRect.width : 0)) : 0;
  const height = root ? Math.round(Math.max(root.scrollHeight, rootRect ? rootRect.height : 0)) : 0;
  const frameWidth = Math.round(window.innerWidth);

  if (grids.length) {
    const g = grids[0];
    const left = Math.min(...g.members.map((n) => n.r.left));
    const right = Math.max(...g.members.map((n) => n.r.right));
    const container = g.members[0].el.parentElement;
    if (container) {
      const cr = container.getBoundingClientRect();
      const slackL = left - cr.left;
      const slackR = cr.right - right;
      // Only meaningful when the container really does enclose the grid.
      if (slackL >= -1 && slackR >= -1 && Math.abs(slackR - slackL) > 24) {
        notes.push(
          `the grid sits off-centre in its container — ${Math.round(slackL)}px of space on the left but ${Math.round(slackR)}px on the right. Give the container width:max-content so it hugs the grid.`,
        );
      }
    }

    const ctlNodes = nodes.filter((n) => n.action && !claimed.has(n.el));
    if (ctlNodes.length >= 2 && ctlNodes.length === g.cols.length) {
      const sortedCtl = ctlNodes.slice().sort((a, b) => a.r.left - b.r.left);
      let worst = 0;
      for (let i = 0; i < g.cols.length; i++) {
        const centre = sortedCtl[i].r.left + sortedCtl[i].r.width / 2;
        worst = Math.max(worst, Math.abs(centre - g.cols[i]));
      }
      if (worst > 12) {
        const ctlPitch =
          sortedCtl.length > 1
            ? (sortedCtl[sortedCtl.length - 1].r.left - sortedCtl[0].r.left) / (sortedCtl.length - 1)
            : 0;
        const colPitch =
          g.cols.length > 1 ? (g.cols[g.cols.length - 1] - g.cols[0]) / (g.cols.length - 1) : 0;
        const detail =
          Math.abs(ctlPitch - colPitch) > 2
            ? `the controls repeat every ${Math.round(ctlPitch)}px but the columns repeat every ${Math.round(colPitch)}px — give both the same grid-template-columns and the same gap`
            : `the two rows start at different x positions — put the controls and the grid in one container and match the container's padding on both`;
        notes.push(
          `the ${ctlNodes.length} controls are up to ${Math.round(worst)}px away from the columns they act on: ${detail}`,
        );
      }
    }
  }

  for (const n of nodes) {
    if (n.text && n.el.scrollWidth > n.el.clientWidth + 2 && n.el.clientWidth > 0) {
      problems.push(`text is clipped in <${n.el.tagName.toLowerCase()}>: "${n.text.slice(0, 40)}"`);
      break;
    }
  }

  // Turning the opponent's cards to face them reads well on a real table and not
  // at all on a screen, where the person is looking at the whole board upright.
  // The rotation is usually set on a wrapper, so the text inherits it from above.
  const ownSpin = new Map<Element, number>();
  for (const n of nodes) ownSpin.set(n.el, n.spun);
  const spinOf = (el: Element): number => {
    let total = 0;
    for (let cur: Element | null = el; cur && cur !== document.body; cur = cur.parentElement) {
      total += ownSpin.get(cur) ?? 0;
    }
    return total;
  };
  for (const n of nodes) {
    const spun = n.text ? spinOf(n.el) : 0;
    if (!n.text || Math.abs(spun) < 12) continue;
    const turn = Math.abs(spun) > 170 ? "upside down" : `turned ${spun}°`;
    problems.push(
      `"${n.text.slice(0, 30)}" is ${turn}, so the person cannot read it — keep text upright and show whose side it is some other way`,
    );
    break;
  }

  // A row of cards wider than the felt it sits on looks broken, and the frame
  // check above misses it because the whole table still fits the viewport.
  for (const n of nodes) {
    if (!n.paint || n.clips || n.r.width < 80) continue;
    let worst = 0;
    for (const c of nodes) {
      if (c === n || !n.el.contains(c.el)) continue;
      worst = Math.max(worst, n.r.left - c.r.left, c.r.right - n.r.right);
    }
    if (worst > 8) {
      problems.push(
        `something inside <${n.el.tagName.toLowerCase()}> sticks out ${Math.round(worst)}px past its edge — give the row the same width as the box, or let the box grow to fit`,
      );
      break;
    }
  }
  if (width > 620) {
    notes.push(
      `the table is ${width}px wide — keep it under about 420px so it sits beside the trajectory panel`,
    );
  }
  for (const n of nodes) {
    if (n.r.right > frameWidth + 4 && frameWidth > 0) {
      problems.push(
        `content runs off the right edge, out to ${Math.round(n.r.right)}px in a ${frameWidth}px frame`,
      );
      break;
    }
  }
  for (const n of nodes) {
    if (!n.text || !n.paint || n.paint.charAt(0) !== "#") continue;
    const pairs = n.paint.slice(1).match(/../g);
    if (!pairs || pairs.length < 3) continue;
    const fg = parseColor(getComputedStyle(n.el).color);
    const bg = parseColor("rgb(" + pairs.map((h) => parseInt(h, 16)).join(",") + ")");
    if (!fg || !bg) continue;
    const l1 = luminance(fg) + 0.05;
    const l2 = luminance(bg) + 0.05;
    const ratio = l1 > l2 ? l1 / l2 : l2 / l1;
    if (ratio < 2.2) {
      notes.push(`"${n.text.slice(0, 30)}" is low contrast against ${n.paint} — hard to read`);
      break;
    }
  }

  const dedupe = (items: string[]) => {
    const out: string[] = [];
    for (const i of items) if (out.indexOf(i) < 0) out.push(i);
    return out;
  };

  let picture = lines.join("\n");
  if (!picture) picture = "(nothing painted)";
  if (picture.length > 2600) picture = picture.slice(0, 2570) + "\n… (truncated)";

  return {
    picture,
    controls,
    actions: controls.map((c) => c.action),
    size: { width, height },
    problems: dedupe(problems).slice(0, 6),
    notes: dedupe(notes).slice(0, 4),
  };
}
