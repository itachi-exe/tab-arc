import { Link } from "react-router-dom";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Clock,
  KeyRound,
  Link2,
  Lock,
  MessageCircle,
  Pause,
  ScanFace,
  ShieldCheck,
  SlidersHorizontal,
  Split,
  Wallet,
} from "lucide-react";
import LiveSection from "./LiveSection";
import { Monogram, TAB_LINE, TabMark, Wordmark, prettyPhone } from "./ui";
import { ARC_EXPLORER, TAB_ADDRESS } from "../lib/tab-contract";
import { IS_TESTNET } from "../lib/network";

const EASE = [0.22, 1, 0.36, 1] as const;

// ─── Motion helpers ──────────────────────────────────────────
function Reveal({
  children,
  delay = 0,
  className = "",
  y = 18,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  y?: number;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.7, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

function SectionHead({
  kicker,
  title,
  sub,
  center = false,
}: {
  kicker: string;
  title: ReactNode;
  sub?: string;
  center?: boolean;
}) {
  return (
    <Reveal className={`flex flex-col gap-4 ${center ? "items-center text-center" : ""}`}>
      <p className="kicker">{kicker}</p>
      <h2 className="text-balance text-[34px] font-semibold leading-[1.05] tracking-[-0.035em] text-ink sm:text-[48px]">
        {title}
      </h2>
      {sub && <p className="max-w-[46ch] text-pretty text-[17px] leading-relaxed text-muted">{sub}</p>}
    </Reveal>
  );
}

// ─── Hero conversation mock ──────────────────────────────────
type Receipt =
  | { kind: "send"; amount: string; to: string; hash: string }
  | { kind: "split"; amount: string; people: { name: string; paid: boolean }[] }
  | { kind: "hold"; amount: string; to: string; until: string }
  | { kind: "balance"; amount: string; left: string; limit: string };

type Scene = { ask: string; reply: string; receipt: Receipt };

const SCENES: Scene[] = [
  {
    ask: "send Jay 20",
    reply: "Sent 20 USDC to Jay. Settled on Arc.",
    receipt: { kind: "send", amount: "20.00", to: "Jay", hash: "0x7c1e…a04f" },
  },
  {
    ask: "split 30 with Jay and Kira",
    reply: "Done. Jay and Kira each got a link for 10.",
    receipt: { kind: "split", amount: "30.00", people: [{ name: "Jay", paid: true }, { name: "Kira", paid: false }] },
  },
  {
    ask: "hold 50 for Kira until Friday",
    reply: "Holding 50 for Kira. Text release when it's done.",
    receipt: { kind: "hold", amount: "50.00", to: "Kira", until: "Fri" },
  },
  {
    ask: "balance",
    reply: "You have 142.50 USDC. 12 left on today's limit.",
    receipt: { kind: "balance", amount: "142.50", left: "12.00", limit: "20.00" },
  },
];

type Msg = { id: number; from: "you" | "tab"; text: string; receipt?: Receipt };

function ReceiptCard({ r }: { r: Receipt }) {
  const head =
    r.kind === "send" ? "Sent" : r.kind === "split" ? "Split" : r.kind === "hold" ? "Held" : "Balance";
  return (
    <div className="mt-1.5 w-[208px] overflow-hidden rounded-[14px] border border-white/10 bg-[#16181c] text-left">
      <div className="flex items-center justify-between px-3 pt-2.5">
        <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-white/45">{head}</span>
        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[#4cb782]">
          <Check size={10} strokeWidth={3} /> Settled
        </span>
      </div>
      <div className="px-3 pb-2.5 pt-1">
        <p className="mono text-[20px] font-medium leading-tight tracking-[-0.03em] text-white">
          {r.amount} <span className="text-[11px] text-white/45">USDC</span>
        </p>
        {r.kind === "send" && (
          <div className="mt-2 flex items-center gap-2">
            <Monogram name={r.to} size={18} />
            <span className="text-[11px] text-white/70">to {r.to}</span>
          </div>
        )}
        {r.kind === "split" && (
          <div className="mt-2 flex flex-col gap-1.5">
            {r.people.map((p) => (
              <div key={p.name} className="flex items-center gap-2">
                <Monogram name={p.name} size={18} />
                <span className="flex-1 text-[11px] text-white/70">{p.name}</span>
                <span className="mono text-[10px] text-white/55">10.00</span>
                <span
                  className={`text-[9.5px] font-medium ${p.paid ? "text-[#4cb782]" : "text-white/40"}`}
                >
                  {p.paid ? "Paid" : "Open"}
                </span>
              </div>
            ))}
          </div>
        )}
        {r.kind === "hold" && (
          <div className="mt-2 flex items-center gap-2">
            <Lock size={12} className="text-[#7cc0ff]" />
            <span className="text-[11px] text-white/70">for {r.to}, until {r.until}</span>
          </div>
        )}
        {r.kind === "balance" && (
          <div className="mt-2">
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full w-[40%] rounded-full bg-[#1b92ff]" />
            </div>
            <p className="mono mt-1.5 text-[10px] text-white/50">
              {r.left} of {r.limit} left today
            </p>
          </div>
        )}
      </div>
      {r.kind !== "balance" && (
        <div className="flex items-center justify-between border-t border-white/[0.07] px-3 py-2">
          <span className="mono text-[10px] text-white/40">{r.kind === "send" ? r.hash : "0x3b9d…e71c"}</span>
          <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-[#5cb3ff]">
            View on Arc <ArrowUpRight size={10} />
          </span>
        </div>
      )}
    </div>
  );
}

function TypingDots() {
  return (
    <div className="bubble-them inline-flex items-center gap-1 px-3.5 py-3">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-white/70 animate-typing-dot"
          style={{ animationDelay: `${i * 0.18}s` }}
        />
      ))}
    </div>
  );
}

function useConversation(active: boolean) {
  const reduce = useReducedMotion();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const idRef = useRef(0);

  useEffect(() => {
    if (reduce) {
      const s = SCENES[0];
      setTimeout(() => setMsgs([
        { id: 1, from: "you", text: s.ask },
        { id: 2, from: "tab", text: s.reply, receipt: s.receipt },
      ]), 0);
      return;
    }
    if (!active) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const wait = (ms: number) =>
      new Promise<void>((res) => {
        timers.push(setTimeout(res, ms));
      });

    void (async () => {
      let i = 0;
      await wait(500);
      while (!cancelled) {
        const s = SCENES[i % SCENES.length];
        for (let c = 1; c <= s.ask.length && !cancelled; c++) {
          setDraft(s.ask.slice(0, c));
          await wait(38 + Math.random() * 40);
        }
        await wait(280);
        if (cancelled) break;
        setDraft("");
        setMsgs((m) => [...m.slice(-3), { id: ++idRef.current, from: "you", text: s.ask }]);
        await wait(450);
        setTyping(true);
        await wait(1100);
        if (cancelled) break;
        setTyping(false);
        setMsgs((m) => [...m.slice(-3), { id: ++idRef.current, from: "tab", text: s.reply, receipt: s.receipt }]);
        await wait(3400);
        i++;
      }
    })();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [active, reduce]);

  return { msgs, draft, typing };
}

function PhoneMock() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-20px" });
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (inView) setTimeout(() => setStarted(true), 0);
  }, [inView]);
  const { msgs, draft, typing } = useConversation(started);

  return (
    <div ref={ref} className="relative mx-auto w-[min(300px,80vw)]" aria-label="Example conversation with Tab" role="img">
      <div
        className="relative overflow-hidden rounded-[46px] p-[9px]"
        style={{
          background: "linear-gradient(160deg, #2a2d33, #121418 40%, #1d2026)",
          boxShadow:
            "0 50px 120px -20px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.08), inset 0 1px 0 rgba(255,255,255,0.12)",
        }}
      >
        <div className="relative flex aspect-[9/19] flex-col overflow-hidden rounded-[38px] bg-[#050506]">
          {/* status bar */}
          <div className="flex items-center justify-between px-6 pt-3 text-[11px] font-semibold text-white/90">
            <span className="tnum">9:41</span>
            <span className="h-[22px] w-[84px] rounded-full bg-black ring-1 ring-white/5" />
            <span className="flex items-center gap-1">
              <span className="h-[9px] w-[16px] rounded-[3px] border border-white/60 p-[1px]">
                <span className="block h-full w-3/4 rounded-[1px] bg-white/90" />
              </span>
            </span>
          </div>
          {/* contact header */}
          <div className="flex flex-col items-center gap-1 border-b border-white/[0.06] pb-2.5 pt-2">
            <TabMark size={34} />
            <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-white/85">
              Tab <ChevronDown size={10} className="-rotate-90 text-white/40" />
            </span>
          </div>
          {/* messages */}
          <div className="flex flex-1 flex-col justify-end gap-2 overflow-hidden px-3 pb-2">
            <AnimatePresence initial={false}>
              {msgs.map((m) => (
                <motion.div
                  key={m.id}
                  layout
                  initial={{ opacity: 0, y: 14, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.45, ease: EASE }}
                  className={`flex flex-col ${m.from === "you" ? "items-end" : "items-start"}`}
                  style={{ transformOrigin: m.from === "you" ? "bottom right" : "bottom left" }}
                >
                  <div
                    className={`max-w-[86%] px-3 py-[7px] text-[12.5px] leading-[1.35] ${
                      m.from === "you" ? "bubble-me" : "bubble-them"
                    }`}
                  >
                    {m.text}
                  </div>
                  {m.receipt && <ReceiptCard r={m.receipt} />}
                </motion.div>
              ))}
              {typing && (
                <motion.div
                  key="typing"
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, transition: { duration: 0.1 } }}
                  className="flex"
                >
                  <TypingDots />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          {/* compose */}
          <div className="flex items-center gap-2 px-3 pb-6 pt-1.5">
            <div className="flex h-8 flex-1 items-center rounded-full border border-white/10 px-3 text-[12px]">
              {draft ? (
                <span className="truncate text-white">
                  {draft}
                  <span className="ml-px inline-block h-3.5 w-px translate-y-[2px] bg-[#1b92ff]" />
                </span>
              ) : (
                <span className="text-white/30">iMessage</span>
              )}
            </div>
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors duration-200 ${
                draft ? "bg-[#1b92ff]" : "bg-white/10"
              }`}
            >
              <ArrowRight size={14} className="-rotate-90 text-white" strokeWidth={2.5} />
            </span>
          </div>
          <div className="absolute bottom-1.5 left-1/2 h-1 w-24 -translate-x-1/2 rounded-full bg-white/40" />
        </div>
      </div>
    </div>
  );
}

function FloatCard({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.8, ease: EASE, delay }}
      className={`card-glass absolute z-20 hidden rounded-2xl p-3.5 shadow-modal lg:block ${className}`}
    >
      <div className="animate-float" style={{ animationDelay: `${delay}s` }}>
        {children}
      </div>
    </motion.div>
  );
}

// ─── Nav ─────────────────────────────────────────────────────
function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-[background,border-color,backdrop-filter] duration-300 ${
        scrolled ? "border-b border-white/[0.07] bg-[rgba(8,9,11,0.72)] backdrop-blur-xl" : "border-b border-transparent"
      }`}
    >
      <nav className="container-x flex h-16 items-center justify-between">
        <Wordmark />
        <div className="hidden items-center gap-1 md:flex">
          {[
            ["How it works", "#how"],
            ["Safety", "#safety"],
            ["Features", "#features"],
            ["FAQ", "#faq"],
          ].map(([label, href]) => (
            <a
              key={href}
              href={href}
              className="rounded-full px-3.5 py-2 text-[14px] text-ink-2 transition-colors duration-150 hover:text-ink"
            >
              {label}
            </a>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Link to="/me" className="btn btn-ghost btn-sm hidden sm:inline-flex">
            Sign in
          </Link>
          <Link to="/join" className="btn btn-light btn-sm">
            Get started
          </Link>
        </div>
      </nav>
    </header>
  );
}

// ─── Hero ────────────────────────────────────────────────────
function PrimaryCtas({ size = "lg" }: { size?: "lg" | "md" }) {
  const cls = size === "lg" ? "btn-lg" : "";
  if (TAB_LINE) {
    return (
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Photon lines only answer linked numbers, so everyone new starts on /join. */}
        <Link to="/join" className={`btn btn-primary ${cls}`}>
          Get started <ArrowRight size={17} />
        </Link>
        <Link to="/me" className={`btn ${cls}`}>
          Open your Tab
        </Link>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 sm:gap-3">
      <Link to="/join" className={`btn btn-primary ${cls}`}>
        Get started <ArrowRight size={17} />
      </Link>
      <Link to="/try" className={`btn btn-ghost ${cls}`}>
        <span>Try it<span className="hidden sm:inline">&nbsp;in the browser</span></span>
      </Link>
    </div>
  );
}

function Hero() {
  const reduce = useReducedMotion();
  const fade = (d: number) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 16 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.8, ease: EASE, delay: d },
        };
  return (
    <section className="relative overflow-hidden pt-28 sm:pt-32 lg:pt-36">
      <div className="page-glow" aria-hidden />
      <div className="grid-bg pointer-events-none absolute inset-x-0 top-0 h-[760px]" aria-hidden />
      <div className="container-x relative z-10 grid items-center gap-14 pb-20 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10 lg:pb-28">
        <div className="flex flex-col items-start gap-7">
          <motion.div {...fade(0)}>
            <span className="chip">
              <span className="live-dot" /> {IS_TESTNET ? "Live on Arc testnet" : "Live on Arc"}
            </span>
          </motion.div>
          <motion.h1
            {...fade(0.06)}
            className="text-balance text-[52px] font-semibold leading-[0.98] tracking-[-0.045em] text-ink sm:text-[72px] lg:text-[84px]"
          >
            Your money,
            <br />
            <span className="serif text-gradient pr-2 font-normal italic tracking-[-0.02em]">by text.</span>
          </motion.h1>
          <motion.p {...fade(0.12)} className="max-w-[44ch] text-pretty text-[18px] leading-relaxed text-ink-2">
            Text Tab like a friend. Real USDC moves on Arc in under a second, and the reply brings the receipt.
          </motion.p>
          <motion.div {...fade(0.18)} className="flex flex-col gap-4">
            <PrimaryCtas />
            {TAB_LINE && (
              <p className="text-[13px] text-muted">
                Text <span className="mono text-ink-2">{prettyPhone(TAB_LINE)}</span> from iMessage
              </p>
            )}
          </motion.div>
          <motion.ul {...fade(0.24)} className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-[13.5px] text-muted">
            {["Under a second to settle", "Face ID above your limit", "Pause any time"].map((t) => (
              <li key={t} className="inline-flex items-center gap-1.5">
                <Check size={14} className="text-accent" strokeWidth={2.5} /> {t}
              </li>
            ))}
          </motion.ul>
        </div>

        <div className="relative flex justify-center lg:justify-end lg:pr-10">
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full animate-glow-pulse"
            style={{ background: "radial-gradient(circle, rgba(27,146,255,0.22), transparent 62%)" }}
            aria-hidden
          />
          <div className="relative">
            <PhoneMock />
            <FloatCard className="-left-44 top-24 w-[200px]" delay={0.6}>
              <div className="flex items-center justify-between text-[11px] text-muted">
                <span>Daily limit</span>
                <span className="mono text-ink-2">20 / 50</span>
              </div>
              <div className="meter mt-2">
                <span style={{ width: "40%" }} />
              </div>
            </FloatCard>
            <FloatCard className="-right-28 bottom-28 w-[188px]" delay={0.9}>
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/15 text-accent">
                  <ScanFace size={19} />
                </span>
                <div>
                  <p className="text-[12.5px] font-medium text-ink">Over the limit</p>
                  <p className="text-[11px] text-muted">You approve with Face ID</p>
                </div>
              </div>
            </FloatCard>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Command strip ───────────────────────────────────────────
const COMMANDS = [
  "send Jay 20",
  "split 30 with Jay and Kira",
  "hold 50 for Kira until Friday",
  "balance",
  "release Kira",
  "send Maya 12.50",
  "pause",
  "split 84 with the team",
];

function CommandStrip() {
  const row = [...COMMANDS, ...COMMANDS];
  return (
    <div className="relative border-y border-white/[0.06] bg-bg-1/60 py-5">
      <div className="marquee-mask overflow-hidden">
        <div className="flex w-max animate-marquee gap-3 hover:[animation-play-state:paused]">
          {row.map((c, i) => (
            <span
              key={i}
              aria-hidden={i >= COMMANDS.length}
              className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-white/[0.08] bg-white/[0.025] px-4 py-2 text-[14px] text-ink-2"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-accent/80" />
              {c}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── How it works ────────────────────────────────────────────
function StepVisualPasskey() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="relative flex h-24 w-24 items-center justify-center">
        <div
          className="absolute inset-0 rounded-[28px] border border-accent/30"
          style={{ background: "radial-gradient(circle, rgba(27,146,255,0.18), transparent 70%)" }}
        />
        <ScanFace size={40} className="relative text-accent" strokeWidth={1.4} />
        <span className="absolute -bottom-2 -right-2 flex h-7 w-7 items-center justify-center rounded-full bg-success text-bg">
          <Check size={15} strokeWidth={3} />
        </span>
      </div>
    </div>
  );
}

function StepVisualLimit() {
  return (
    <div className="flex h-full flex-col justify-center gap-3 px-2">
      <div className="flex items-center justify-between text-[12px] text-muted">
        <span>Agent can spend</span>
        <span className="mono text-ink">50.00 / day</span>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {["25", "50", "100", "250"].map((v) => (
          <span
            key={v}
            className={`mono rounded-lg border py-2 text-center text-[13px] ${
              v === "50" ? "border-accent/50 bg-accent/15 text-ink" : "border-white/[0.08] text-muted"
            }`}
          >
            {v}
          </span>
        ))}
      </div>
    </div>
  );
}

function StepVisualText() {
  return (
    <div className="flex h-full flex-col justify-center gap-2 px-1">
      <div className="bubble-me self-end px-3 py-1.5 text-[13px]">send Jay 20</div>
      <div className="bubble-them self-start px-3 py-1.5 text-[13px]">
        Sent. <span className="text-[#5cb3ff]">View on Arc</span>
      </div>
    </div>
  );
}

const STEPS = [
  {
    n: "01",
    title: "Open your Tab",
    body: "A passkey wallet made with Face ID. No seed phrase, no extension.",
    visual: <StepVisualPasskey />,
  },
  {
    n: "02",
    title: "Set a daily limit",
    body: "Add USDC and pick what the agent may spend each day.",
    visual: <StepVisualLimit />,
  },
  {
    n: "03",
    title: "Text it",
    body: "Send, split, hold, check your balance. Every reply has an Arc receipt.",
    visual: <StepVisualText />,
  },
];

function HowItWorks() {
  return (
    <section id="how" className="section-y scroll-mt-16">
      <div className="container-x flex flex-col gap-14">
        <SectionHead kicker="How it works" title="Three steps. Then just text." />
        <div className="grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 0.08}>
              <div className="card card-hover inset-top flex h-full flex-col overflow-hidden">
                <div className="h-40 border-b border-white/[0.06] bg-white/[0.012] p-5">{s.visual}</div>
                <div className="flex flex-col gap-2 p-6">
                  <span className="mono text-[12px] text-accent">{s.n}</span>
                  <h3 className="text-[20px] font-semibold tracking-[-0.025em] text-ink">{s.title}</h3>
                  <p className="text-[15px] leading-relaxed text-muted">{s.body}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Safety ──────────────────────────────────────────────────
function LimitMeterCard() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const [spent, setSpent] = useState(0);
  useEffect(() => {
    if (!inView) return;
    const target = 32;
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min((t - start) / 1400, 1);
      setSpent(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView]);
  const pct = (spent / 50) * 100;
  return (
    <div ref={ref} className="card inset-top flex h-full flex-col justify-between gap-10 p-6 sm:p-8 lg:row-span-2">
      <div className="flex flex-col gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 text-accent">
          <SlidersHorizontal size={19} />
        </span>
        <h3 className="text-[24px] font-semibold tracking-[-0.03em] text-ink">A daily limit the agent can't break.</h3>
        <p className="max-w-[38ch] text-[15px] leading-relaxed text-muted">
          You set it on your Tab. The contract enforces it, not the agent.
        </p>
      </div>
      <div className="rounded-2xl border border-white/[0.07] bg-bg/60 p-5">
        <div className="flex items-baseline justify-between">
          <span className="text-[13px] text-muted">Spent by text today</span>
          <span className="mono text-[13px] text-muted">limit 20.00</span>
        </div>
        <p className="mono mt-2 text-[44px] font-medium leading-none tracking-[-0.04em] text-ink">
          {spent.toFixed(2)}
          <span className="ml-1.5 text-[15px] text-muted">USDC</span>
        </p>
        <div className="meter mt-5">
          <span style={{ width: `${pct}%` }} />
        </div>
        <div className="mono mt-2 flex justify-between text-[11px] text-faint">
          <span>0</span>
          <span>25</span>
          <span>50</span>
        </div>
      </div>
    </div>
  );
}

function FaceIdCard() {
  return (
    <div className="card inset-top flex h-full flex-col gap-6 p-6 sm:p-8">
      <div className="flex items-center gap-4">
        <div className="relative flex h-16 w-16 flex-shrink-0 items-center justify-center">
          <span
            className="absolute inset-0 rounded-2xl"
            style={{
              background: "conic-gradient(from 0deg, rgba(27,146,255,0.9), transparent 40%, rgba(27,146,255,0.9))",
              padding: 1,
              WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
              WebkitMaskComposite: "xor",
              maskComposite: "exclude",
            }}
          />
          <span className="absolute inset-[1px] rounded-2xl bg-bg-2" />
          <ScanFace size={28} className="relative text-accent" strokeWidth={1.5} />
        </div>
        <div>
          <p className="text-[13px] text-muted">send Kira 120</p>
          <p className="text-[15px] font-medium text-ink">Over your limit. Tap to confirm.</p>
        </div>
      </div>
      <div>
        <h3 className="text-[20px] font-semibold tracking-[-0.025em] text-ink">Bigger moves need your face.</h3>
        <p className="mt-1.5 text-[15px] leading-relaxed text-muted">
          Above the limit you get a confirm link and sign with Face ID yourself.
        </p>
      </div>
    </div>
  );
}

function PauseCard() {
  const [paused, setPaused] = useState(false);
  return (
    <div className="card inset-top flex h-full flex-col gap-6 p-6 sm:p-8">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span
            className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors duration-300 ${
              paused ? "bg-white/[0.06] text-muted" : "bg-success/15 text-success"
            }`}
          >
            {paused ? <Pause size={18} /> : <MessageCircle size={18} />}
          </span>
          <div>
            <p className="text-[15px] font-medium text-ink">{paused ? "Texting paused" : "Texting on"}</p>
            <p className="text-[12.5px] text-muted">{paused ? "Tab ignores every text" : "Tab acts on your texts"}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          aria-pressed={paused}
          aria-label="Try the pause switch"
          className={`relative h-8 w-[52px] flex-shrink-0 rounded-full transition-colors duration-300 ${
            paused ? "bg-white/[0.12]" : "bg-accent"
          }`}
        >
          <motion.span
            className="absolute top-1 h-6 w-6 rounded-full bg-white shadow"
            animate={{ left: paused ? 4 : 24 }}
            transition={{ type: "spring", stiffness: 500, damping: 34 }}
          />
        </button>
      </div>
      <div>
        <h3 className="text-[20px] font-semibold tracking-[-0.025em] text-ink">One switch to pause.</h3>
        <p className="mt-1.5 text-[15px] leading-relaxed text-muted">Lost your phone? Pause texting and nothing moves.</p>
      </div>
    </div>
  );
}

function Safety() {
  return (
    <section id="safety" className="section-y relative scroll-mt-16">
      <div className="container-x flex flex-col gap-14">
        <SectionHead
          kicker="Safety"
          title={
            <>
              The agent works for you.
              <br className="hidden sm:block" /> <span className="text-muted">It never holds the keys.</span>
            </>
          }
        />
        <div className="grid gap-4 lg:grid-cols-2">
          <Reveal className="lg:row-span-2">
            <LimitMeterCard />
          </Reveal>
          <Reveal delay={0.08}>
            <FaceIdCard />
          </Reveal>
          <Reveal delay={0.14}>
            <PauseCard />
          </Reveal>
        </div>
        <Reveal>
          <div className="grid gap-px overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.07] sm:grid-cols-3">
            {[
              { icon: <Wallet size={17} />, t: "Deposits and withdrawals", d: "Always signed by you. Never by text." },
              { icon: <KeyRound size={17} />, t: "Passkey wallet", d: "Your key lives in your device, behind Face ID." },
              { icon: <ShieldCheck size={17} />, t: "Numbers stay private", d: "Phone numbers never touch the chain." },
            ].map((x) => (
              <div key={x.t} className="flex items-start gap-3 bg-bg-1 p-5">
                <span className="mt-0.5 text-accent">{x.icon}</span>
                <div>
                  <p className="text-[15px] font-medium text-ink">{x.t}</p>
                  <p className="mt-0.5 text-[14px] text-muted">{x.d}</p>
                </div>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ─── Features showcase ───────────────────────────────────────
function ClaimVisual() {
  return (
    <div className="mx-auto w-full max-w-[340px] rounded-[22px] border border-white/10 bg-bg-2 p-6 shadow-modal">
      <div className="flex items-center gap-3">
        <Monogram name="Maya" size={40} />
        <div>
          <p className="text-[14px] text-muted">Maya sent you</p>
          <p className="mono text-[30px] font-medium leading-tight tracking-[-0.04em] text-ink">
            25.00 <span className="text-[14px] text-muted">USDC</span>
          </p>
        </div>
      </div>
      <div className="btn btn-primary btn-block mt-6 pointer-events-none" aria-hidden>
        <ScanFace size={17} /> Claim with Face ID
      </div>
      <p className="mt-3 text-center text-[12.5px] text-faint">No app. No seed phrase.</p>
    </div>
  );
}

function SplitVisual() {
  const rows = [
    { n: "You", paid: true },
    { n: "Jay", paid: true },
    { n: "Kira", paid: false },
  ];
  return (
    <div className="mx-auto w-full max-w-[340px] rounded-[22px] border border-white/10 bg-bg-2 p-6 shadow-modal">
      <div className="flex items-baseline justify-between">
        <p className="text-[14px] text-muted">Dinner split</p>
        <p className="mono text-[14px] text-ink">30.00</p>
      </div>
      <div className="meter mt-3">
        <span style={{ width: "66.6%" }} />
      </div>
      <div className="mt-5 flex flex-col gap-3">
        {rows.map((r) => (
          <div key={r.n} className="flex items-center gap-3">
            <Monogram name={r.n} size={30} />
            <span className="flex-1 text-[14px] text-ink">{r.n}</span>
            <span className="mono text-[13px] text-ink-2">10.00</span>
            <span className={`chip ${r.paid ? "chip-success" : ""}`}>{r.paid ? "Paid" : "Link sent"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HoldVisual() {
  return (
    <div className="mx-auto w-full max-w-[340px] rounded-[22px] border border-white/10 bg-bg-2 p-6 shadow-modal">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 text-accent">
          <Lock size={18} />
        </span>
        <div>
          <p className="text-[14px] text-muted">Held for Kira</p>
          <p className="mono text-[26px] font-medium leading-tight tracking-[-0.04em] text-ink">50.00</p>
        </div>
      </div>
      <ol className="mt-6 flex flex-col gap-0">
        {[
          { t: "Held in the contract", s: "Mon", on: true },
          { t: "You text release", s: "Anytime", on: false },
          { t: "Back to you if unreleased", s: "After Fri", on: false },
        ].map((x, i, a) => (
          <li key={x.t} className="relative flex gap-3 pb-4 last:pb-0">
            {i < a.length - 1 && <span className="absolute left-[7px] top-4 h-full w-px bg-white/10" />}
            <span
              className={`relative mt-1 h-[15px] w-[15px] flex-shrink-0 rounded-full border-2 ${
                x.on ? "border-accent bg-accent/30" : "border-white/20 bg-bg-2"
              }`}
            />
            <div className="flex flex-1 items-baseline justify-between gap-2">
              <span className="text-[14px] text-ink-2">{x.t}</span>
              <span className="mono text-[12px] text-faint">{x.s}</span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

const FEATURES = [
  {
    key: "claim",
    icon: <Link2 size={17} />,
    label: "Claim",
    cmd: "send Maya 25",
    title: "Friends without Tab still get paid.",
    body: "They get a claim link and claim in one tap.",
    visual: <ClaimVisual />,
  },
  {
    key: "split",
    icon: <Split size={17} />,
    label: "Split",
    cmd: "split 30 with Jay and Kira",
    title: "Everyone pays their share.",
    body: "Each person gets a link. The split closes when the last one pays.",
    visual: <SplitVisual />,
  },
  {
    key: "hold",
    icon: <Clock size={17} />,
    label: "Hold",
    cmd: "hold 50 for Kira until Friday",
    title: "Escrow, by text.",
    body: "Money waits in the contract until you release it.",
    visual: <HoldVisual />,
  },
] as const;

function Features() {
  const [active, setActive] = useState(0);
  const f = FEATURES[active];
  return (
    <section id="features" className="section-y relative scroll-mt-16">
      <div className="container-x flex flex-col gap-14">
        <SectionHead kicker="More than send" title="Claim, split and hold." />
        <Reveal>
          <div className="card inset-top grid overflow-hidden lg:grid-cols-[0.9fr_1.1fr]">
            <div className="flex flex-col gap-2 border-b border-white/[0.06] p-3 sm:p-4 lg:border-b-0 lg:border-r">
              <div role="tablist" aria-label="Features" className="grid grid-cols-3 gap-1 lg:grid-cols-1 lg:gap-2">
                {FEATURES.map((x, i) => {
                  const on = i === active;
                  return (
                    <button
                      key={x.key}
                      role="tab"
                      aria-selected={on}
                      onClick={() => setActive(i)}
                      className={`relative rounded-xl text-left transition-colors duration-200 ${
                        on ? "bg-white/[0.05]" : "hover:bg-white/[0.025]"
                      }`}
                    >
                      {on && (
                        <motion.span
                          layoutId="feat-ring"
                          className="absolute inset-0 rounded-xl border border-white/[0.12]"
                          transition={{ duration: 0.4, ease: EASE }}
                        />
                      )}
                      <div className="relative flex items-center justify-center gap-2 px-3 py-3 lg:justify-start lg:px-5 lg:py-5">
                        <span className={on ? "text-accent" : "text-muted"}>{x.icon}</span>
                        <span className={`text-[15px] font-medium ${on ? "text-ink" : "text-ink-2"}`}>{x.label}</span>
                      </div>
                      <div className="relative hidden px-5 pb-5 lg:block">
                        <p className="text-[15px] text-muted">{x.body}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="relative flex min-h-[460px] flex-col items-center justify-center gap-8 overflow-hidden p-6 sm:p-10">
              <div
                className="pointer-events-none absolute inset-0"
                style={{ background: "radial-gradient(ellipse 60% 50% at 50% 40%, rgba(27,146,255,0.12), transparent 70%)" }}
                aria-hidden
              />
              <AnimatePresence mode="wait">
                <motion.div
                  key={f.key}
                  initial={{ opacity: 0, y: 12, filter: "blur(4px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, y: -8, filter: "blur(4px)" }}
                  transition={{ duration: 0.35, ease: EASE }}
                  className="relative flex w-full flex-col items-center gap-6"
                >
                  <div className="bubble-me self-center px-4 py-2 text-[14px]">{f.cmd}</div>
                  {f.visual}
                  <div className="text-center lg:hidden">
                    <h3 className="text-[20px] font-semibold tracking-[-0.025em] text-ink">{f.title}</h3>
                    <p className="mt-1 text-[15px] text-muted">{f.body}</p>
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ─── Built on ────────────────────────────────────────────────
function BuiltOn() {
  const short = TAB_ADDRESS ? `${TAB_ADDRESS.slice(0, 6)}…${TAB_ADDRESS.slice(-4)}` : "";
  return (
    <section className="border-y border-white/[0.06] bg-bg-1/60">
      <div className="container-x grid gap-8 py-12 md:grid-cols-[auto_1fr_auto] md:items-center md:gap-12">
        <p className="kicker">Built on</p>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          {[
            { n: "Arc", d: "Circle's L1. Gas is paid in USDC." },
            { n: "USDC", d: "Digital dollars that settle onchain." },
            { n: "Circle", d: "Passkey wallets with Face ID." },
          ].map((x) => (
            <div key={x.n} className="flex flex-col gap-1">
              <span className="text-[20px] font-semibold tracking-[-0.03em] text-ink">{x.n}</span>
              <span className="text-[14px] text-muted">{x.d}</span>
            </div>
          ))}
        </div>
        {short && (
          <a
            href={`${ARC_EXPLORER}/address/${TAB_ADDRESS}`}
            target="_blank"
            rel="noopener noreferrer"
            className="chip h-9 self-start px-3.5 transition-colors hover:border-white/20 hover:text-ink md:self-center"
          >
            Contract <span className="mono text-ink">{short}</span> <ArrowUpRight size={13} />
          </a>
        )}
      </div>
    </section>
  );
}

// ─── FAQ ─────────────────────────────────────────────────────
const FAQS = [
  {
    q: "Is this real money?",
    a: IS_TESTNET
      ? "Tab runs on Arc testnet today, so it moves test USDC. The contract and the flow are the real thing."
      : "Yes. Tab moves real USDC on Arc. Texts are capped by your daily limit, and you can pause them any time.",
  },
  {
    q: "What if someone gets my phone?",
    a: "Texts can only spend up to your daily limit. Anything above it needs your Face ID, and you can pause texting from your Tab.",
  },
  {
    q: "Can the agent withdraw my money?",
    a: "No. Deposits and withdrawals are always signed by you on your own device.",
  },
  {
    q: "Does my friend need Tab?",
    a: "No. They get a claim link and claim in one tap with Face ID.",
  },
  {
    q: "Is my phone number on chain?",
    a: "Never. The contract only sees wallet addresses.",
  },
  {
    q: "Do I need ETH or another token for gas?",
    a: "No. Gas on Arc is paid in USDC.",
  },
];

function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="section-y scroll-mt-16">
      <div className="container-x grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
        <SectionHead kicker="FAQ" title="Questions, answered." />
        <Reveal>
          <div className="flex flex-col border-t border-white/[0.08]">
            {FAQS.map((f, i) => {
              const on = open === i;
              return (
                <div key={f.q} className="border-b border-white/[0.08]">
                  <button
                    type="button"
                    aria-expanded={on}
                    onClick={() => setOpen(on ? null : i)}
                    className="flex w-full items-center justify-between gap-6 py-5 text-left"
                  >
                    <span className="text-[17px] font-medium tracking-[-0.015em] text-ink">{f.q}</span>
                    <ChevronDown
                      size={18}
                      className={`flex-shrink-0 text-muted transition-transform duration-300 ${on ? "rotate-180" : ""}`}
                    />
                  </button>
                  <AnimatePresence initial={false}>
                    {on && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.35, ease: EASE }}
                        className="overflow-hidden"
                      >
                        <p className="max-w-[56ch] pb-6 text-[15.5px] leading-relaxed text-muted">{f.a}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ─── Final CTA ───────────────────────────────────────────────
function FinalCta() {
  return (
    <section className="pb-24 sm:pb-32">
      <div className="container-x">
        <Reveal>
          <div className="relative overflow-hidden rounded-[32px] border border-white/[0.09] px-6 py-20 text-center sm:px-12 sm:py-28">
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  "radial-gradient(ellipse 60% 70% at 50% 110%, rgba(27,146,255,0.35), transparent 70%), linear-gradient(180deg, #0c0e11, #08090b)",
              }}
              aria-hidden
            />
            <div className="grid-bg pointer-events-none absolute inset-0 opacity-60" aria-hidden />
            <div className="relative flex flex-col items-center gap-7">
              <TabMark size={48} />
              <h2 className="text-balance text-[40px] font-semibold leading-[1] tracking-[-0.045em] text-ink sm:text-[64px]">
                Your wallet is
                <br />
                <span className="serif font-normal italic tracking-[-0.02em]">a text away.</span>
              </h2>
              <p className="max-w-[36ch] text-[17px] text-muted">Make your Tab in under a minute with Face ID.</p>
              <PrimaryCtas />
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ─── Footer ──────────────────────────────────────────────────
function Footer() {
  return (
    <footer className="border-t border-white/[0.06]">
      <div className="container-x flex flex-col gap-10 py-12 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-3">
          <Wordmark />
          <p className="max-w-[30ch] text-[14px] text-muted">A USDC wallet you control by text. Built for Arc.</p>
        </div>
        <div className="grid grid-cols-2 gap-x-14 gap-y-3 text-[14px]">
          <Link to="/join" className="text-ink-2 hover:text-ink">Get started</Link>
          <Link to="/me" className="text-ink-2 hover:text-ink">Open your Tab</Link>
          <a href="#how" className="text-ink-2 hover:text-ink">How it works</a>
          <Link to="/try" className="text-ink-2 hover:text-ink">Try in the browser</Link>
          <a href="#safety" className="text-ink-2 hover:text-ink">Safety</a>
          {TAB_ADDRESS && (
            <a
              href={`${ARC_EXPLORER}/address/${TAB_ADDRESS}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-ink-2 hover:text-ink"
            >
              Contract <ArrowUpRight size={13} />
            </a>
          )}
          <a href="#faq" className="text-ink-2 hover:text-ink">FAQ</a>
        </div>
      </div>
      <div className="container-x flex flex-col gap-2 border-t border-white/[0.05] py-6 text-[13px] text-faint sm:flex-row sm:justify-between">
        <span>{IS_TESTNET ? "Testnet. No real funds." : "Real USDC on Arc."}</span>
        <span>
          Built on Arc with{" "}
          <a href="https://studio.arc.io/" target="_blank" rel="noopener noreferrer" className="text-muted hover:text-ink">
            Arc Studio
          </a>
        </span>
      </div>
    </footer>
  );
}

// ─── Page ────────────────────────────────────────────────────
export default function LandingPage() {
  return (
    <div className="relative min-h-dvh overflow-x-clip bg-bg text-ink">
      <Nav />
      <main>
        <Hero />
        <CommandStrip />
        <HowItWorks />
        <Safety />
        <Features />
        <LiveSection />
        <BuiltOn />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
