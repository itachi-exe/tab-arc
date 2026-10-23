import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { formatUnits, parseAbiItem } from "viem";
import { TAB_ADDRESS, ARC_EXPLORER } from "../lib/tab-contract";

type Tx = { kind: string; amount: string; hash: string; block: bigint };
type State =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "error" }
  | { status: "ready"; moved: number; closed: number; recent: Tx[] };

const EV = {
  sent: parseAbiItem("event Sent(address indexed from, address indexed to, uint256 amount)"),
  splitPaid: parseAbiItem("event SplitPaid(bytes32 indexed splitId, address indexed payer, uint256 share)"),
  splitClosed: parseAbiItem("event SplitClosed(bytes32 indexed splitId)"),
  claim: parseAbiItem("event ClaimCreated(bytes32 indexed claimId, address indexed from, uint256 amount)"),
  hold: parseAbiItem("event HoldCreated(bytes32 indexed holdId, address indexed from, address indexed to, uint256 amount, uint256 deadline)"),
};

const usdc = (v: bigint) => Number(formatUnits(v, 6));

function CountUp({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || value === 0) { setTimeout(() => setShown(value), 0); return; }
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min((t - start) / 1200, 1);
      setShown(value * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return (
    <span className="mono tabular-nums">
      {shown.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
    </span>
  );
}

function Skeleton({ w, h }: { w: string; h: number }) {
  return <div className="skeleton" style={{ width: w, height: h }} />;
}

export default function LiveSection() {
  const client = usePublicClient();
  const [state, setState] = useState<State>({ status: "loading" });
  const explorer = client?.chain?.blockExplorers?.default.url ?? ARC_EXPLORER;

  useEffect(() => {
    if (!TAB_ADDRESS) { setTimeout(() => setState({ status: "empty" }), 0); return; }
    if (!client) return;
    let off = false;
    void (async () => {
      try {
        const q = { address: TAB_ADDRESS, fromBlock: 0n } as const;
        const [sent, paid, closed, claims, holds] = await Promise.all([
          client.getLogs({ ...q, event: EV.sent }),
          client.getLogs({ ...q, event: EV.splitPaid }),
          client.getLogs({ ...q, event: EV.splitClosed }),
          client.getLogs({ ...q, event: EV.claim }),
          client.getLogs({ ...q, event: EV.hold }),
        ]);
        const moved =
          sent.reduce((a, l) => a + usdc(l.args.amount ?? 0n), 0) +
          paid.reduce((a, l) => a + usdc(l.args.share ?? 0n), 0) +
          claims.reduce((a, l) => a + usdc(l.args.amount ?? 0n), 0) +
          holds.reduce((a, l) => a + usdc(l.args.amount ?? 0n), 0);
        const recent: Tx[] = [
          ...sent.map((l) => ({ kind: "Send", amount: usdc(l.args.amount ?? 0n).toFixed(2), hash: l.transactionHash, block: l.blockNumber })),
          ...paid.map((l) => ({ kind: "Split payment", amount: usdc(l.args.share ?? 0n).toFixed(2), hash: l.transactionHash, block: l.blockNumber })),
          ...claims.map((l) => ({ kind: "Claim", amount: usdc(l.args.amount ?? 0n).toFixed(2), hash: l.transactionHash, block: l.blockNumber })),
          ...holds.map((l) => ({ kind: "Hold", amount: usdc(l.args.amount ?? 0n).toFixed(2), hash: l.transactionHash, block: l.blockNumber })),
        ]
          .sort((a, b) => (a.block < b.block ? 1 : -1))
          .slice(0, 5);
        if (off) return;
        setState(recent.length ? { status: "ready", moved, closed: closed.length, recent } : { status: "empty" });
      } catch {
        if (!off) setState({ status: "error" });
      }
    })();
    return () => { off = true; };
  }, [client]);

  const moved = state.status === "ready" ? state.moved : 0;
  const closed = state.status === "ready" ? state.closed : 0;
  const loading = state.status === "loading";

  return (
    <section className="section-y relative">
      <div className="container-x flex flex-col gap-10">
        <div className="flex flex-col gap-4">
          <p className="kicker inline-flex items-center gap-2">
            <span className="live-dot" /> Live on Arc
          </p>
          <h2 className="text-balance text-[34px] font-semibold leading-[1.05] tracking-[-0.035em] text-ink sm:text-[48px]">
            Straight from the contract.
          </h2>
        </div>

        <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-1">
            {[
              { label: "USDC moved", node: <CountUp value={moved} decimals={2} /> },
              { label: "Splits closed", node: <CountUp value={closed} /> },
            ].map(({ label, node }) => (
              <div key={label} className="card inset-top flex flex-col justify-between gap-6 p-5 sm:p-7">
                <p className="text-[14px] text-muted">{label}</p>
                <div className="mono font-medium text-ink" style={{ fontSize: "clamp(28px, 4.4vw, 52px)", letterSpacing: "-0.04em", lineHeight: 1, minHeight: "1em" }}>
                  {loading ? <Skeleton w="70%" h={36} /> : node}
                </div>
              </div>
            ))}
          </div>

          <div className="card inset-top overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
              <p className="text-[14px] font-medium text-ink">Latest on chain</p>
              <span className="mono text-[12px] text-faint">Tab v2</span>
            </div>

            {loading &&
              [0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3 border-b border-white/[0.05] px-5 py-4 last:border-b-0">
                  <Skeleton w="32px" h={32} />
                  <div className="flex flex-1 flex-col gap-2"><Skeleton w="40%" h={12} /><Skeleton w="22%" h={10} /></div>
                </div>
              ))}

            {state.status === "empty" && (
              <div className="flex flex-col items-center gap-3 px-5 py-14 text-center">
                <p className="text-[15px] text-ink-2">No tabs yet. The first one shows up here once it settles.</p>
                <a href="/try" className="text-[14px] font-medium text-accent">Send the first one</a>
              </div>
            )}

            {state.status === "error" && (
              <div className="px-5 py-14 text-center">
                <p className="text-[15px] text-ink-2">Couldn't reach Arc. Refresh to try again.</p>
              </div>
            )}

            {state.status === "ready" &&
              state.recent.map((tx, i) => (
                <div key={tx.hash + i} className="flex items-center gap-3 border-b border-white/[0.05] px-5 py-4 last:border-b-0">
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-accent/15 text-[12px] font-medium text-accent">
                    {tx.kind[0]}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-medium text-ink">{tx.kind}</p>
                    <p className="mono truncate text-[11.5px] text-faint">{tx.hash.slice(0, 10)}…{tx.hash.slice(-6)}</p>
                  </div>
                  <span className="mono text-[14px] text-ink">{tx.amount}</span>
                  <a href={`${explorer}/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer" aria-label={`View ${tx.kind} on Arc`} className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-white/5 hover:text-ink">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10L10 4M5 4h5v5" /></svg>
                  </a>
                </div>
              ))}
          </div>
        </div>
      </div>
    </section>
  );
}
