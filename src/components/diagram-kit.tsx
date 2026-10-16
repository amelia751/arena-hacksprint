export type Glyph =
  | "person"
  | "book"
  | "eye"
  | "shield"
  | "play"
  | "save"
  | "engine"
  | "frame"
  | "loop"
  | "seats"
  | "store"
  | "plug"
  | "board"
  | "mask"
  | "ban"
  | "link"
  | "file"
  | "camera"
  | "server";

export function Icon({ glyph, tone }: { glyph: Glyph; tone?: string }) {
  return (
    <svg
      className="dg-ico"
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={tone ? { color: tone } : undefined}
    >
      {shape(glyph)}
    </svg>
  );
}

function shape(glyph: Glyph) {
  switch (glyph) {
    case "person":
      return (
        <>
          <circle cx="12" cy="8" r="3.4" />
          <path d="M5.5 19.6c1.3-3.5 3.6-5.2 6.5-5.2s5.2 1.7 6.5 5.2" />
        </>
      );
    case "book":
      return (
        <>
          <path d="M4 5.5h6.2c1 0 1.8.8 1.8 1.8V19a2.4 2.4 0 0 0-2.4-1.7H4z" />
          <path d="M20 5.5h-6.2c-1 0-1.8.8-1.8 1.8V19a2.4 2.4 0 0 1 2.4-1.7H20z" />
        </>
      );
    case "eye":
      return (
        <>
          <path d="M2.6 12S6 6.6 12 6.6 21.4 12 21.4 12 18 17.4 12 17.4 2.6 12 2.6 12z" />
          <circle cx="12" cy="12" r="2.8" />
        </>
      );
    case "shield":
      return (
        <>
          <path d="M12 3.2l7 2.6v6c0 4.2-2.8 7.3-7 9-4.2-1.7-7-4.8-7-9v-6z" />
          <path d="M8.8 12.2l2.3 2.3 4.1-4.6" />
        </>
      );
    case "play":
      return (
        <>
          <circle cx="12" cy="12" r="8.8" />
          <path d="M10 8.6l6 3.4-6 3.4z" />
        </>
      );
    case "save":
      return (
        <>
          <path d="M12 4v10.4" />
          <path d="M8 11l4 3.8 4-3.8" />
          <path d="M4.8 18.6h14.4" />
        </>
      );
    case "engine":
      return (
        <>
          <rect x="6.4" y="6.4" width="11.2" height="11.2" rx="2.2" />
          <path d="M10 2.8v3.6M14 2.8v3.6M10 17.6v3.6M14 17.6v3.6M2.8 10h3.6M2.8 14h3.6M17.6 10h3.6M17.6 14h3.6" />
        </>
      );
    case "frame":
      return (
        <>
          <rect x="3.4" y="4.6" width="17.2" height="14.8" rx="2.2" />
          <path d="M3.4 9h17.2" />
          <circle cx="6.4" cy="6.8" r="0.7" />
        </>
      );
    case "loop":
      return (
        <>
          <path d="M20 12a8 8 0 1 1-2.6-5.9" />
          <path d="M20.4 3.6v4.2h-4.2" />
        </>
      );
    case "seats":
      return (
        <>
          <circle cx="8.4" cy="9" r="2.8" />
          <circle cx="16" cy="9" r="2.8" />
          <path d="M3.4 19c.9-2.6 2.6-3.9 5-3.9M13.2 19c.9-2.6 2.6-3.9 5-3.9" />
        </>
      );
    case "store":
      return (
        <>
          <ellipse cx="12" cy="6.4" rx="7.4" ry="2.8" />
          <path d="M4.6 6.4v11.2c0 1.6 3.3 2.8 7.4 2.8s7.4-1.2 7.4-2.8V6.4" />
          <path d="M4.6 12c0 1.6 3.3 2.8 7.4 2.8s7.4-1.2 7.4-2.8" />
        </>
      );
    case "plug":
      return (
        <>
          <path d="M9 3.4v5M15 3.4v5" />
          <path d="M6.4 8.4h11.2v2.2a5.6 5.6 0 0 1-5.6 5.6 5.6 5.6 0 0 1-5.6-5.6z" />
          <path d="M12 16.2v4.4" />
        </>
      );
    case "board":
      return (
        <>
          <rect x="3.4" y="3.4" width="17.2" height="17.2" rx="2.2" />
          <path d="M9.1 3.4v17.2M14.9 3.4v17.2M3.4 9.1h17.2M3.4 14.9h17.2" />
        </>
      );
    case "mask":
      return (
        <>
          <path d="M4 7.2l1.8 1.8L9 5.4M4 16.4l1.8 1.8 3.2-3.6" />
          <path d="M12.4 7.6h7.6M12.4 16.6h7.6" />
        </>
      );
    case "ban":
      return (
        <>
          <circle cx="12" cy="12" r="8.6" />
          <path d="M6.2 6.2l11.6 11.6" />
        </>
      );
    case "link":
      return (
        <>
          <path d="M10.2 13.8a3.6 3.6 0 0 0 5.2 0l2.8-2.8a3.7 3.7 0 0 0-5.2-5.2l-1.4 1.4" />
          <path d="M13.8 10.2a3.6 3.6 0 0 0-5.2 0l-2.8 2.8a3.7 3.7 0 0 0 5.2 5.2l1.4-1.4" />
        </>
      );
    case "file":
      return (
        <>
          <path d="M6 3.4h7.4L18.6 8v12.6H6z" />
          <path d="M13.2 3.6V8.2h4.8" />
          <path d="M8.8 12.6h6.4M8.8 16.2h6.4" />
        </>
      );
    case "camera":
      return (
        <>
          <path d="M3.6 8.2h3.6l1.6-2.4h6.4l1.6 2.4h3.6v10.2H3.6z" />
          <circle cx="12" cy="13" r="3.2" />
        </>
      );
    case "server":
      return (
        <>
          <rect x="3.6" y="4.4" width="16.8" height="6" rx="1.8" />
          <rect x="3.6" y="13.6" width="16.8" height="6" rx="1.8" />
          <path d="M7.2 7.4h.02M7.2 16.6h.02" />
        </>
      );
  }
}

export function Brand({ src, label, note }: { src: string; label: string; note?: string }) {
  return (
    <span className="dg-brand">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" width={20} height={20} />
      <b>{label}</b>
      {note ? <i>{note}</i> : null}
    </span>
  );
}
