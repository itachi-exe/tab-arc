import { useParams, useNavigate } from "react-router-dom";
import { useReadContract } from "wagmi";
import { tabAbi, TAB_ADDRESS, tabCall, explorerTx, ARC_MAINNET_CHAIN_ID } from "../lib/tab-contract";
import { useAction, useTabWallet } from "../lib/wallet";
import SignIn from "./SignIn";
import { AppShell, Panel } from "./ui";

function CheckIcon() {
  return (
    <svg
      width="44"
      height="44"
      viewBox="0 0 32 32"
      fill="none"
      strokeWidth="2"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: "var(--success)" }}
    >
      <circle cx="16" cy="16" r="14" strokeOpacity="0.2" />
      <path
        d="M9 16l5 5 9-9"
        style={{
          strokeDasharray: 24,
          animation: "check-draw 0.5s cubic-bezier(0.22,1,0.36,1) forwards",
        }}
      />
    </svg>
  );
}

export default function SplitPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { address } = useTabWallet();
  const isConnected = !!address;

  type HexStr = `0x${string}`;
  const ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000" as HexStr;
  const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as HexStr;
  const splitId: HexStr = id ? (`0x${id.padEnd(64, "0")}`) : ZERO;
  const callerAddr: HexStr = (address as HexStr) ?? ZERO_ADDR;

  const { data: meta } = useReadContract({
    address: TAB_ADDRESS,
    abi: tabAbi,
    functionName: "getSplitMeta",
    args: [splitId] as [HexStr],
    chainId: ARC_MAINNET_CHAIN_ID,
  });

  const { data: share } = useReadContract({
    address: TAB_ADDRESS,
    abi: tabAbi,
    functionName: "getSplitShare",
    args: [splitId, callerAddr] as [HexStr, HexStr],
    chainId: ARC_MAINNET_CHAIN_ID,
    query: { enabled: !!address },
  });

  const { data: alreadyPaid } = useReadContract({
    address: TAB_ADDRESS,
    abi: tabAbi,
    functionName: "isSplitPayerPaid",
    args: [splitId, callerAddr] as [HexStr, HexStr],
    chainId: ARC_MAINNET_CHAIN_ID,
    query: { enabled: !!address },
  });

  const { run, hash, pending: isPending, done: isSuccess, error: errorMsg } = useAction();
  const isConfirming = false;

  const [, , , closed] = (meta as [string, bigint, bigint, boolean]) ?? ["", 0n, 0n, false];
  const shareUsdc = share ? (Number(share) / 1e6).toFixed(2) : null;

  function handlePay() {
    if (!address) return;
    void run([tabCall("paySplit", [splitId, address])]);
  }

  const [, payerCount, paidCount] = (meta as [string, bigint, bigint, boolean]) ?? ["", 0n, 0n, false];
  const total = Number(payerCount ?? 0n);
  const paid = Number(paidCount ?? 0n);

  return (
    <AppShell>
      <div className="flex flex-col gap-6 animate-slide-up">
        <Panel className="flex flex-col gap-7 overflow-hidden">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-40"
            style={{ background: "radial-gradient(ellipse 70% 100% at 50% 0%, rgba(27,146,255,0.14), transparent 70%)" }}
            aria-hidden
          />
          <div className="relative flex flex-col items-center gap-3 pt-2 text-center">
            <p className="kicker">{closed ? "Split" : "Your share"}</p>
            {closed ? (
              <h1 className="text-[30px] font-semibold tracking-[-0.035em] text-ink">This split is settled.</h1>
            ) : shareUsdc ? (
              <p className="mono text-[52px] font-medium leading-none tracking-[-0.045em] text-ink">
                {shareUsdc}
                <span className="ml-2 text-[18px] text-muted">USDC</span>
              </p>
            ) : isConnected ? (
              <div className="skeleton h-[52px] w-48" />
            ) : (
              <h1 className="text-[30px] font-semibold tracking-[-0.035em] text-ink">You're in a split.</h1>
            )}
          </div>

          {total > 0 && (
            <div className="relative flex flex-col gap-2.5">
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-muted">Paid so far</span>
                <span className="mono text-ink-2">
                  {paid} of {total}
                </span>
              </div>
              <div className="flex gap-1.5">
                {Array.from({ length: Math.min(total, 12) }).map((_, k) => (
                  <span
                    key={k}
                    className={`h-1.5 flex-1 rounded-full transition-colors duration-500 ${k < paid ? "bg-accent" : "bg-white/10"}`}
                  />
                ))}
              </div>
            </div>
          )}

          {!isConnected ? (
            <div className="relative">
              <SignIn verb="pay" />
            </div>
          ) : alreadyPaid ? (
            <div className="relative flex flex-col items-center gap-4 animate-scale-in">
              <CheckIcon />
              <p className="text-[15px] font-medium text-success">Your share is paid.</p>
              <button onClick={() => void navigate("/me")} className="btn btn-block btn-lg">
                View balance
              </button>
            </div>
          ) : closed ? (
            <p className="relative text-center text-[14px] text-muted">Everyone paid. Nothing left to do.</p>
          ) : isSuccess ? (
            <div className="relative flex flex-col items-center gap-4 animate-scale-in">
              <CheckIcon />
              <div className="flex flex-col items-center gap-1">
                <p className="text-[15px] font-medium text-success">Paid {shareUsdc} USDC</p>
                {hash && (
                  <a href={explorerTx(hash)} target="_blank" rel="noopener noreferrer" className="text-[13px] text-accent hover:underline">
                    View on Arc
                  </a>
                )}
              </div>
              <button onClick={() => void navigate("/me")} className="btn btn-primary btn-lg btn-block">
                View balance
              </button>
            </div>
          ) : (
            <div className="relative flex flex-col gap-3">
              <button onClick={handlePay} disabled={isPending || isConfirming || !share} className="btn btn-primary btn-lg btn-block">
                {isPending || isConfirming ? "Paying..." : shareUsdc ? `Pay ${shareUsdc} USDC` : "Loading..."}
              </button>
              {errorMsg && <p className="text-center text-[13px] text-danger">{errorMsg}</p>}
            </div>
          )}
        </Panel>
        <p className="text-center text-[12.5px] text-faint">Settles on Arc in under a second.</p>
      </div>
    </AppShell>
  );
}
