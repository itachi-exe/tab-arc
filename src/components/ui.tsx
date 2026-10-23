import { Link } from "react-router-dom";
import type { ReactNode } from "react";

/** The iMessage line people text. Empty string when not configured. */
export const TAB_LINE = (import.meta.env.VITE_TAB_LINE ?? "").trim();

export function smsHref(body?: string) {
  if (!TAB_LINE) return "";
  return body ? `sms:${TAB_LINE}&body=${encodeURIComponent(body)}` : `sms:${TAB_LINE}`;
}

export function prettyPhone(raw: string) {
  const d = raw.replace(/[^\d]/g, "");
  if (d.length === 11 && d.startsWith("1")) return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)} ${d.slice(7)}`;
  return raw;
}

/** Tab mark: a lowercase t whose hook is the tail of a text bubble. */
export function TabMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="none" aria-hidden>
      <rect width="256" height="256" rx="58" fill="url(#tabmark-g)" />
      <rect x="2" y="2" width="252" height="252" rx="56" stroke="rgba(255,255,255,0.18)" strokeWidth="4" />
      <g fill="#fff" transform="translate(128 128) scale(1.1) translate(-122 -133)">
        <path d="M98 66 A21 21 0 0 1 140 66 L140 164 C140 186 154 202 196 212 C158 228 98 224 98 172 Z" />
        <rect x="60" y="94" width="124" height="38" rx="19" />
      </g>
      <defs>
        <linearGradient id="tabmark-g" x1="0" y1="0" x2="256" y2="256" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3ea4ff" />
          <stop offset="1" stopColor="#1580ec" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function Wordmark({ size = 22, to = "/" }: { size?: number; to?: string }) {
  return (
    <Link to={to} className="inline-flex items-center gap-2 rounded-lg" aria-label="Tab home">
      <TabMark size={size} />
      <span className="font-semibold tracking-[-0.03em] text-ink" style={{ fontSize: size * 0.82 }}>
        Tab
      </span>
    </Link>
  );
}

const MONO_TINTS = [
  ["rgba(27,146,255,0.16)", "#8cc8ff"],
  ["rgba(255,255,255,0.08)", "#e6e6e3"],
  ["rgba(76,183,130,0.14)", "#8fd6b1"],
  ["rgba(200,170,255,0.12)", "#d2c2ff"],
  ["rgba(255,196,120,0.12)", "#f2cf9c"],
] as const;

/** Monogram avatar for a person. Never a photo, never an emoji. */
export function Monogram({ name, size = 32 }: { name: string; size?: number }) {
  const clean = name.replace(/^0x/i, "").trim() || "?";
  const letters = clean
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  let h = 0;
  for (const c of clean) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const [bg, fg] = MONO_TINTS[h % MONO_TINTS.length];
  return (
    <span
      aria-hidden
      className="inline-flex flex-shrink-0 items-center justify-center rounded-full font-medium"
      style={{
        width: size,
        height: size,
        background: bg,
        color: fg,
        fontSize: Math.round(size * 0.38),
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)",
        letterSpacing: "-0.02em",
      }}
    >
      {letters}
    </span>
  );
}

/** Shell for the single-task screens (claim, split, confirm, me, try). */
export function AppShell({
  children,
  right,
  wide = false,
}: {
  children: ReactNode;
  right?: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="relative min-h-dvh overflow-x-clip bg-bg text-ink">
      <div className="page-glow" aria-hidden />
      <div className="grid-bg pointer-events-none absolute inset-x-0 top-0 h-[520px]" aria-hidden />
      <header className="relative z-10">
        <div className="container-x flex h-16 items-center justify-between">
          <Wordmark />
          {right}
        </div>
      </header>
      <main
        className={`relative z-10 mx-auto w-full px-5 pb-24 pt-6 sm:pt-12 ${wide ? "max-w-[960px]" : "max-w-[440px]"}`}
      >
        {children}
      </main>
    </div>
  );
}

/** Bordered panel used by every single-task screen. */
export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card inset-top p-6 sm:p-7 ${className}`}>{children}</div>;
}

export function Kicker({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`kicker ${className}`}>{children}</p>;
}
