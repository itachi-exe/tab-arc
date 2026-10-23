import { useState, useEffect } from "react";
import { useReadContract } from "wagmi";
import { encodeFunctionData, erc20Abi } from "viem";
import { tabAbi, TAB_ADDRESS, tabCall, explorerTx, ARC_MAINNET_CHAIN_ID } from "../lib/tab-contract";
import { useAction, useTabWallet } from "../lib/wallet";
import SignIn from "./SignIn";
import { AppShell, Monogram, Panel, TabMark } from "./ui";
import Activity from "./Activity";
import { getUsdc } from "@/onchain-facts";
import { parseAmount } from "@/onchain-money";
import { useNavigate } from "react-router-dom";

const CHAIN_ID = ARC_MAINNET_CHAIN_ID;
const usdcFact = getUsdc(CHAIN_ID);
const USDC_ADDRESS = (usdcFact?.address ?? "") as `0x${string}`;
const DEFAULT_DAILY_LIMIT = 20;

// ─── Skeleton loader ─────────────────────────────────────────
function Skeleton({ w, h, className = "" }: { w?: string | number; h?: string | number; className?: string }) {
  return <div className={`skeleton ${className}`} style={{ width: w, height: h ?? 16 }} />;
}

// ─── Amount input sheet ─────────────────────────────────────
function AmountSheet({
  label,
  placeholder = "0.00",
  value,
  onChange,
  onSubmit,
  loading,
  success,
  hash,
  submitLabel,
  error,
}: {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  loading: boolean;
  success: boolean;
  hash?: `0x${string}`;
  submitLabel: string;
  error?: string;
}) {
  return (
    <div className="card inset-top flex flex-col gap-4 p-5 animate-slide-up">
      <div className="flex items-center justify-between">
        <p className="text-[15px] font-medium text-ink">{label}</p>
        <span className="text-[12px] text-faint">Signed by you</span>
      </div>

      <div className="relative">
        <span className="mono absolute left-4 top-1/2 -translate-y-1/2 text-[22px] text-muted">$</span>
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="input mono h-14 pl-9 text-[24px] font-medium"
        />
      </div>

      {success ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 rounded-xl bg-success/10 p-3 text-[14px] text-success">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" strokeWidth="1.75" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 8l4 4 8-8" />
            </svg>
            {label === "Add funds" ? "Deposited" : "Withdrawn"} successfully.
          </div>
          {hash && (
            <a href={explorerTx(hash)} target="_blank" rel="noopener noreferrer" className="text-center text-[13px] text-accent hover:underline">
              View on Arc
            </a>
          )}
        </div>
      ) : (
        <>
          <button onClick={onSubmit} disabled={loading || !value} className="btn btn-primary btn-lg btn-block">
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin" width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <circle cx="7" cy="7" r="5" stroke="rgba(255,255,255,0.3)" strokeWidth="2"/>
                  <path d="M7 2a5 5 0 0 1 5 5" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                {submitLabel}
              </span>
            ) : submitLabel}
          </button>
          {error && <p className="text-center text-[13px] text-danger">{error}</p>}
        </>
      )}
    </div>
  );
}

export default function MePage() {
  const navigate = useNavigate();
  const { address, name, kind, signOut } = useTabWallet();
  const isConnected = !!address;
  // Your Tab username, once your number is linked. It's how people pay you.
  const [username, setUsername] = useState<string | null>(null);
  const [linkChecked, setLinkChecked] = useState(false);
  useEffect(() => {
    setUsername(null);
    setLinkChecked(false);
    if (!address) return;
    fetch(`/api/username/${address}`).then((r) => r.json()).then((d: { username?: string | null }) => { setUsername(d.username ?? null); setLinkChecked(true); }).catch(() => {});
  }, [address]);

  const hasTab = /^0x[0-9a-fA-F]{40}$/.test(TAB_ADDRESS);
  const zero = "0x0000000000000000000000000000000000000000" as const;

  // USDC sitting in the connected wallet itself.
  const { data: rawWallet, isLoading: walletLoading, refetch: refetchWallet } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address ?? zero],
    chainId: CHAIN_ID,
    query: { enabled: !!address && !!USDC_ADDRESS, refetchInterval: 15_000 },
  });

  // USDC deposited into Tab (only once the contract is deployed).
  const { data: rawTab, isLoading: tabLoading, refetch: refetchTab } = useReadContract({
    address: TAB_ADDRESS,
    abi: tabAbi,
    functionName: "balances",
    args: [address ?? zero],
    chainId: CHAIN_ID,
    query: { enabled: !!address && hasTab, refetchInterval: 15_000 },
  });
  const balanceLoading = walletLoading || (hasTab && tabLoading);
  const refetchBalance = () => { void refetchWallet(); if (hasTab) void refetchTab(); };
  const rawBalance = (rawWallet ?? 0n) + ((rawTab) ?? 0n);

  const { data: rawLimit } = useReadContract({
    address: TAB_ADDRESS,
    abi: tabAbi,
    functionName: "dailyLimit",
    args: [address ?? "0x0000000000000000000000000000000000000000"],
    chainId: CHAIN_ID,
    query: { enabled: !!address },
  });

  const { data: rawSpent } = useReadContract({
    address: TAB_ADDRESS,
    abi: tabAbi,
    functionName: "spentToday",
    args: [address ?? "0x0000000000000000000000000000000000000000"],
    chainId: CHAIN_ID,
    query: { enabled: !!address },
  });

  // Anything other than an in-flight read (empty wallet, no contract, RPC error) shows $0.00, never a blank card.
  const balance = balanceLoading
    ? null
    : (Number(rawBalance) / 1e6).toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
      });
  const limitUsdc = rawLimit ? Number(rawLimit) / 1e6 : DEFAULT_DAILY_LIMIT;
  const spentUsdc = rawSpent ? Number(rawSpent) / 1e6 : 0;
  const pct = Math.min(100, (spentUsdc / limitUsdc) * 100);

  const [activePanel, setActivePanel] = useState<"add" | "send" | null>(null);
  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const deposit = useAction();
  const withdraw = useAction();
  const depositing = deposit.pending;
  const withdrawing = withdraw.pending;
  const depositSuccess = deposit.done;
  const withdrawSuccess = withdraw.done;

  function handleDeposit() {
    if (!address || !depositAmount) return;
    let amt: ReturnType<typeof parseAmount>;
    try {
      amt = parseAmount(CHAIN_ID, depositAmount);
    } catch {
      return;
    }
    // Approve and deposit go out together: one Face ID prompt, and no
    // leftover allowance if the deposit fails (the batch is all or nothing).
    void deposit.run(async () => {
      // Check the wallet first, so an empty wallet gets a clear line, not a revert.
      const r = await fetch(`/api/wallet-usdc/${address}`).then((x) => x.json() as Promise<{ raw?: string } | null>).catch(() => null);
      if (r && typeof r.raw === "string" && BigInt(r.raw) < amt.raw) throw new Error("WALLET_LOW");
      return [
      { to: USDC_ADDRESS, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [TAB_ADDRESS, amt.raw] }) },
      tabCall("deposit", [amt.raw]),
      ];
    });
  }

  function handleWithdraw() {
    if (!address || !withdrawAmount) return;
    const amt = parseAmount(CHAIN_ID, withdrawAmount);
    void withdraw.run([tabCall("withdraw", [amt.raw])]);
  }

  useEffect(() => {
    if (withdrawSuccess || depositSuccess) refetchBalance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withdrawSuccess, depositSuccess]);

  // ── Not connected ──────────────────────────────────────────
  if (!isConnected) {
    return (
      <AppShell>
        <div className="flex flex-col items-center gap-8 pt-6 animate-slide-up sm:pt-10">
          <div className="flex flex-col items-center gap-4 text-center">
            <TabMark size={56} />
            <h1 className="text-[34px] font-semibold tracking-[-0.04em] text-ink">Your Tab</h1>
            <p className="max-w-[30ch] text-[15px] text-muted">Your balance, your limit, everything you've sent.</p>
          </div>
          <Panel className="w-full">
            <SignIn />
          </Panel>
          <button onClick={() => void navigate("/")} className="btn btn-ghost btn-sm">
            Back to home
          </button>
        </div>
      </AppShell>
    );
  }

  // ── Connected ──────────────────────────────────────────────
  const who = username ? `@${username}` : name ?? (kind === "wallet" ? "Wallet" : "You");
  const limitLabel = Number.isInteger(limitUsdc) ? limitUsdc.toFixed(0) : limitUsdc.toFixed(2);
  return (
    <AppShell
      wide
      right={
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] py-1 pl-1 pr-3 text-[13px] text-ink-2">
            <Monogram name={who} size={26} />
            {who}
          </span>
          <button onClick={signOut} className="btn btn-ghost btn-sm">
            Sign out
          </button>
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr] lg:items-start">
        <div className="flex flex-col gap-4">
          {linkChecked && !username && (
            <button
              onClick={() => void navigate("/join")}
              className="card inset-top flex items-center justify-between gap-3 p-4 text-left animate-slide-up"
            >
              <span className="text-[15px] text-ink">Link your number to text Tab</span>
              <span className="text-[14px] font-medium text-accent">Link</span>
            </button>
          )}
          {/* Balance hero */}
          <div className="card inset-top relative flex flex-col gap-2 overflow-hidden p-6 sm:p-8 animate-slide-up">
            <div
              className="pointer-events-none absolute inset-0"
              style={{ background: "radial-gradient(ellipse 80% 90% at 0% 0%, rgba(27,146,255,0.16), transparent 60%)" }}
              aria-hidden
            />
            <p className="kicker relative">Balance</p>
            {balance === null ? (
              <Skeleton w={200} h={56} className="relative my-1" />
            ) : (
              <p className="mono relative text-[48px] font-medium leading-[1.05] tracking-[-0.045em] text-ink sm:text-[56px]">
                {balance}
              </p>
            )}
            <p className="relative text-[14px] text-muted">USDC on Arc</p>

            <div className="relative mt-5 grid grid-cols-2 gap-2">
              <button
                onClick={() => setActivePanel(activePanel === "add" ? null : "add")}
                aria-pressed={activePanel === "add"}
                className={`btn ${activePanel === "add" ? "btn-primary" : ""}`}
              >
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M8 3v10M3 8h10" /></svg>
                Add
              </button>
              <button
                onClick={() => setActivePanel(activePanel === "send" ? null : "send")}
                aria-pressed={activePanel === "send"}
                className={`btn ${activePanel === "send" ? "btn-primary" : ""}`}
              >
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 13V3M4 7l4-4 4 4" /></svg>
                Withdraw
              </button>
            </div>
          </div>

          {/* Add panel */}
          {activePanel === "add" && (
            <AmountSheet
              label="Add funds"
              value={depositAmount}
              onChange={setDepositAmount}
              onSubmit={handleDeposit}
              loading={depositing}
              success={depositSuccess}
              hash={deposit.hash}
              submitLabel={depositing ? "Adding..." : "Add USDC"}
              error={deposit.error}
            />
          )}

          {/* Withdraw panel */}
          {activePanel === "send" && (
            <AmountSheet
              label="Withdraw USDC"
              value={withdrawAmount}
              onChange={setWithdrawAmount}
              onSubmit={handleWithdraw}
              loading={withdrawing}
              success={withdrawSuccess}
              hash={withdraw.hash}
              submitLabel={withdrawing ? "Withdrawing..." : "Withdraw USDC"}
              error={withdraw.error}
            />
          )}

          {/* Daily limit */}
          <div className="card inset-top flex flex-col gap-4 p-6 animate-slide-up" style={{ animationDelay: "60ms" }}>
            <div className="flex items-center justify-between">
              <p className="text-[15px] font-medium text-ink">Daily agent limit</p>
              <p className="mono text-[14px] text-ink-2">
                {spentUsdc.toFixed(2)} <span className="text-faint">/ {limitLabel}</span>
              </p>
            </div>
            <div className="meter">
              <span
                style={{
                  width: `${pct}%`,
                  ...(pct > 90 ? { background: "var(--danger)", boxShadow: "0 0 16px rgba(255,138,138,0.4)" } : {}),
                }}
              />
            </div>
            <p className="text-[13px] text-muted">Texts spend up to this each day. Above it, you confirm with Face ID.</p>
          </div>
        </div>

        {/* Recent activity */}
        <div className="card inset-top overflow-hidden animate-slide-up" style={{ animationDelay: "120ms" }}>
          <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
            <p className="text-[15px] font-medium text-ink">Recent activity</p>
            <span className="live-dot" aria-hidden />
          </div>
          {address && hasTab ? (
            <Activity address={address} refreshKey={Number(rawTab ?? 0n)} />
          ) : (
            <p className="py-12 text-center text-[14px] text-faint">No activity yet</p>
          )}
        </div>
      </div>
    </AppShell>
  );
}
