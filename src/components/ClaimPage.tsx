import { useParams, useNavigate } from "react-router-dom";
import { usePublicClient, useReadContract } from "wagmi";
import { privateKeyToAccount } from "viem/accounts";
import { tabAbi, TAB_ADDRESS, tabCall, explorerTx } from "../lib/tab-contract";
import { ARC_CHAIN_ID } from "../lib/network";
import { useAction, useTabWallet } from "../lib/wallet";
import SignIn from "./SignIn";
import { AppShell, Panel } from "./ui";
import { formatUnits } from "viem";

/** Hex-typed view of a value we already validated. */
const hex = (s: string): `0x${string}` => s as `0x${string}`;

function CheckIcon() {
  return (
    <svg
      width="48"
      height="48"
      viewBox="0 0 48 48"
      fill="none"
      strokeWidth="2"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: "var(--success)" }}
    >
      <circle cx="24" cy="24" r="20" strokeOpacity="0.15" />
      <path
        d="M14 24l7 7 13-13"
        style={{
          strokeDasharray: 30,
          animation: "check-draw 0.5s cubic-bezier(0.22,1,0.36,1) forwards",
        }}
      />
    </svg>
  );
}

function GiftIcon() {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 32 32"
      fill="none"
      strokeWidth="1.5"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: "var(--accent)" }}
    >
      <rect x="4" y="13" width="24" height="16" rx="2" />
      <path d="M4 13h24M16 13V29" />
      <path d="M16 13c0 0-4-6 0-8 4 2 0 8 0 8z" />
      <path d="M16 13c0 0 4-6 0-8-4 2 0 8 0 8z" />
    </svg>
  );
}

export default function ClaimPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { address } = useTabWallet();
  const isConnected = !!address;

  // The link is /claim/<claimId>#k=<one-time key>. The key lives only in the
  // URL fragment, which browsers never send to any server.
  const claimId = id && /^[0-9a-f]{64}$/i.test(id) ? (`0x${id}`) : undefined;
  const linkKey = (() => {
    const k = new URLSearchParams(window.location.hash.slice(1)).get("k");
    return k && /^0x[0-9a-f]{64}$/i.test(k) ? (k as `0x${string}`) : undefined;
  })();
  const publicClient = usePublicClient({ chainId: ARC_CHAIN_ID });
  const { run, hash, pending: isPending, done: isSuccess, error } = useAction();
  const isConfirming = false;
  // A link that was already used says so before anyone taps.
  const { data: claimRow } = useReadContract({
    address: TAB_ADDRESS, abi: tabAbi, functionName: "claims",
    args: claimId ? [hex(claimId)] : undefined, chainId: ARC_CHAIN_ID,
    query: { enabled: !!claimId },
  });
  const usedBefore = !isSuccess && !!claimRow && (claimRow[3] || claimRow[4]);
  const claimed = isSuccess;

  function handleClaim() {
    if (!claimId || !address || !linkKey || !publicClient) return;
    void run(async () => {
      // The link key signs "pay this claim to <your address>", so nobody who
      // sees the transaction can swap in a different recipient.
      const digest = await publicClient.readContract({
        address: TAB_ADDRESS,
        abi: tabAbi,
        functionName: "claimDigest",
        args: [hex(claimId), hex(address)],
      });
      const signature = await privateKeyToAccount(linkKey).signMessage({ message: { raw: digest } });
      return [tabCall("claim", [claimId, address, signature])];
    });
  }

  const errorMsg = !linkKey ? "This link is incomplete. Ask the sender to forward the full message." : error;
  const amount = claimRow && claimRow[2] > 0n ? Number(formatUnits(claimRow[2], 6)).toFixed(2) : null;

  return (
    <AppShell>
      <div className="flex flex-col gap-6 animate-slide-up">
        <Panel className="flex flex-col gap-7 overflow-hidden">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-40"
            style={{ background: "radial-gradient(ellipse 70% 100% at 50% 0%, rgba(27,146,255,0.16), transparent 70%)" }}
            aria-hidden
          />
          <div className="relative flex flex-col items-center gap-5 pt-2 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-accent/25 bg-accent/10">
              <GiftIcon />
            </div>
            <div className="flex flex-col items-center gap-2">
              <p className="kicker">{usedBefore ? "Claim link" : "Someone sent you"}</p>
              {amount && !usedBefore ? (
                <p className="mono text-[52px] font-medium leading-none tracking-[-0.045em] text-ink">
                  {amount}
                  <span className="ml-2 text-[18px] text-muted">USDC</span>
                </p>
              ) : (
                <h1 className="text-[30px] font-semibold tracking-[-0.035em] text-ink">
                  {usedBefore ? "Already claimed." : "You have USDC waiting."}
                </h1>
              )}
              <p className="text-[15px] text-muted">
                {usedBefore ? "This link was already used." : "Claim it in one tap. No app needed."}
              </p>
            </div>
          </div>

          {usedBefore ? null : !isConnected ? (
            <div className="relative">
              <SignIn verb="claim" />
            </div>
          ) : claimed || isSuccess ? (
            <div className="relative flex flex-col items-center gap-5 animate-scale-in">
              <CheckIcon />
              <div className="flex flex-col items-center gap-1.5 text-center">
                <p className="text-[15px] font-medium text-success">Claimed. It's in your Tab.</p>
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
              <button
                onClick={handleClaim}
                disabled={isPending || isConfirming || !claimId || !linkKey}
                className="btn btn-primary btn-lg btn-block"
              >
                {isPending || isConfirming ? "Claiming..." : "Claim USDC"}
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
