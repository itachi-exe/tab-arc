import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { parseAbiItem, type Log } from "viem";
import { TAB_ADDRESS, explorerTx, ARC_MAINNET_CHAIN_ID } from "../lib/tab-contract";

// Reads the user's Tab history straight from chain events. Arc RPCs cap
// eth_getLogs at 10k blocks (about 80 minutes), so we walk backwards in
// windows, stopping at the deploy block, after MAX_WINDOWS, or at 20 rows.
const WINDOW = 9_999n;
const MAX_WINDOWS = 24;
const DEPLOY_BLOCK = BigInt((import.meta.env.VITE_TAB_DEPLOY_BLOCK as string | undefined) || "0");

const EV = {
  sent: parseAbiItem("event Sent(address indexed from, address indexed to, uint256 amount)"),
  dep: parseAbiItem("event Deposited(address indexed user, uint256 amount)"),
  wd: parseAbiItem("event Withdrawn(address indexed user, uint256 amount)"),
  splitPaid: parseAbiItem("event SplitPaid(bytes32 indexed splitId, address indexed payer, uint256 share)"),
  claimed: parseAbiItem("event Claimed(bytes32 indexed claimId, address indexed recipient)"),
  claimMade: parseAbiItem("event ClaimCreated(bytes32 indexed claimId, address indexed from, uint256 amount)"),
  hold: parseAbiItem("event HoldCreated(bytes32 indexed holdId, address indexed from, address indexed to, uint256 amount, uint256 deadline)"),
  holdReleased: parseAbiItem("event HoldReleased(bytes32 indexed holdId)"),
  holdRefunded: parseAbiItem("event HoldRefunded(bytes32 indexed holdId)"),
};

const ALL = Object.values(EV);

type Row = { key: string; label: string; amount?: bigint; incoming: boolean; hash: string; block: bigint; index: number;
  hold?: { id: string; outgoing: boolean; other: string } };

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const fmt = (v: bigint) => (Number(v) / 1e6).toFixed(2);

export default function Activity({ address, refreshKey }: { address: `0x${string}`; refreshKey: number }) {
  const client = usePublicClient({ chainId: ARC_MAINNET_CHAIN_ID });
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!client) return;
    let dead = false;
    setTimeout(() => setFailed(false), 0);
    const me = address.toLowerCase();
    const is = (v: unknown) => String(v).toLowerCase() === me;
    // Public Arc RPCs rate limit hard, so: one getLogs per window (every Tab
    // event, filtered here), windows walked one at a time, 429s retried.
    const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const logsIn = async (from: bigint, to: bigint) => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await client.getLogs({ address: TAB_ADDRESS, events: ALL, fromBlock: from, toBlock: to } as never);
        } catch (e) {
          if (attempt >= 4 || dead) throw e;
          await pause(600 * 2 ** attempt);
        }
      }
    };
    (async () => {
      const head = await client.getBlockNumber();
      const found: Row[] = [];
      const addrs = new Map<string, string>();
      const note = (v: unknown) => { const a = String(v); addrs.set(a.toLowerCase(), a); return a; };
      // A hold settles later in its own event, so the row's final wording waits for the whole scan.
      const settled = new Map<string, "released" | "refunded">();
      for (let to = head, i = 0; i < MAX_WINDOWS && to >= DEPLOY_BLOCK && !dead && found.length < 20; i++, to -= WINDOW + 1n) {
        const from = to - WINDOW < DEPLOY_BLOCK ? DEPLOY_BLOCK : to - WINDOW;
        const logs = (await logsIn(from, to)) as unknown as (Log & { eventName: string; args: Record<string, unknown> })[];
        for (const l of logs) {
          const a = l.args;
          const row = (r: Omit<Row, "hash" | "block" | "index" | "key">) =>
            found.push({ ...r, hash: l.transactionHash!, block: l.blockNumber!, index: l.logIndex!, key: `${l.transactionHash}-${l.logIndex}` });
          switch (l.eventName) {
            case "Sent":
              if (is(a.from)) row({ label: `Sent to ${short(note(a.to))}`, amount: a.amount as bigint, incoming: false });
              else if (is(a.to)) row({ label: `From ${short(note(a.from))}`, amount: a.amount as bigint, incoming: true });
              break;
            case "Deposited": if (is(a.user)) row({ label: "Added", amount: a.amount as bigint, incoming: true }); break;
            case "Withdrawn": if (is(a.user)) row({ label: "Withdrew", amount: a.amount as bigint, incoming: false }); break;
            case "SplitPaid": if (is(a.payer)) row({ label: "Paid a split", amount: a.share as bigint, incoming: false }); break;
            case "Claimed": if (is(a.recipient)) row({ label: "Claimed a link", incoming: true }); break;
            case "ClaimCreated": if (is(a.from)) row({ label: "Sent a claim link", amount: a.amount as bigint, incoming: false }); break;
            case "HoldCreated":
              if (is(a.from)) row({ label: "", amount: a.amount as bigint, incoming: false, hold: { id: String(a.holdId), outgoing: true, other: short(note(a.to)) } });
              else if (is(a.to)) row({ label: "", amount: a.amount as bigint, incoming: true, hold: { id: String(a.holdId), outgoing: false, other: short(note(a.from)) } });
              break;
            case "HoldReleased": settled.set(String(a.holdId), "released"); break;
            case "HoldRefunded": settled.set(String(a.holdId), "refunded"); break;
          }
        }
        if (from === DEPLOY_BLOCK) break;
      }
      if (dead) return;
      for (const r of found) {
        if (!r.hold) continue;
        const s = settled.get(r.hold.id), o = r.hold.other;
        if (r.hold.outgoing) {
          r.label = s === "released" ? `Sent to ${o}` : s === "refunded" ? `Hold for ${o} returned` : `Holding for ${o}`;
          if (s === "refunded") r.amount = undefined;
        } else {
          r.label = s === "released" ? `From ${o}` : s === "refunded" ? `${o} took back a hold` : `Held for you by ${o}`;
          if (s !== "released") r.amount = undefined;
        }
      }
      // People, not addresses: swap in @usernames where the counterparty has one.
      const seen = new Map<string, string>();
      for (const l of found) for (const m of l.label.matchAll(/0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4}/g)) seen.set(m[0], "");
      const full = new Map<string, string>();
      for (const [k, v] of addrs) if (seen.has(short(v))) full.set(k, v);
      const names = await Promise.all([...full.values()].map((a) =>
        fetch(`/api/username/${a}`).then((r) => r.json()).then((d: { username?: string | null }) => [short(a), d.username ?? ""] as const).catch(() => [short(a), ""] as const)));
      if (dead) return;
      for (const [s, n] of names) if (n) for (const r of found) r.label = r.label.replace(s, `@${n}`);
      found.sort((x, y) => (x.block === y.block ? y.index - x.index : x.block > y.block ? -1 : 1));
      setRows(found.slice(0, 20));
    })().catch(() => {
      if (dead) return;
      setFailed(true);
      setRows([]);
    });
    return () => { dead = true; };
  }, [client, address, refreshKey]);

  if (failed) {
    return <p className="py-12 text-center text-[14px] text-faint">Activity is busy. Reload in a moment.</p>;
  }
  if (rows === null) {
    return (
      <ul className="flex flex-col" aria-label="Loading activity">
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className="flex items-center gap-3 border-b border-white/[0.05] px-5 py-4 last:border-b-0">
            <div className="skeleton h-9 w-9 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <div className="skeleton h-3 w-2/5" />
              <div className="skeleton h-2.5 w-1/4" />
            </div>
            <div className="skeleton h-3.5 w-14" />
          </li>
        ))}
      </ul>
    );
  }
  if (rows.length === 0) {
    return <p className="py-12 text-center text-[14px] text-faint">No activity yet</p>;
  }
  return (
    <ul className="flex flex-col">
      {rows.map((r) => (
        <li key={r.key} className="border-b border-white/[0.05] last:border-b-0">
          <a
            href={explorerTx(r.hash)}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 px-5 py-3.5 transition-colors duration-150 hover:bg-white/[0.025]"
          >
            <span
              className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${
                r.incoming ? "bg-accent/15 text-accent" : "bg-white/[0.05] text-muted"
              }`}
              aria-hidden
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                {r.incoming ? <path d="M8 3v10M4 9l4 4 4-4" /> : <path d="M8 13V3M4 7l4-4 4 4" />}
              </svg>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] text-ink">{r.label}</span>
              <span className="mono block truncate text-[11px] text-faint">{short(r.hash)}</span>
            </span>
            {r.amount !== undefined && (
              <span className={`mono text-[14px] ${r.incoming ? "text-accent" : "text-ink-2"}`}>
                {r.incoming ? "+" : "\u2212"}
                {fmt(r.amount)}
              </span>
            )}
          </a>
        </li>
      ))}
    </ul>
  );
}
