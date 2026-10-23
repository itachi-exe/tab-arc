import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { tabCall, explorerTx } from "../lib/tab-contract";
import { useAction, useTabWallet } from "../lib/wallet";
import SignIn from "./SignIn";
import { AppShell, Monogram, Panel } from "./ui";

interface PendingAction {
  id: string;
  type: "send" | "split" | "hold" | "release";
  fromHandle: string;
  data: {
    to?: string;
    toName?: string;
    amount?: number;
    claimId?: string;
    recipient?: string;
    raw?: string;
  };
  createdAt: number;
}

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

function ShieldIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      strokeWidth="1.5"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: "var(--accent)" }}
    >
      <path d="M14 3l9 4v6c0 5-4 9-9 11C9 22 5 18 5 13V7l9-4z" />
      <path d="M10 14l3 3 5-5" />
    </svg>
  );
}

export default function ConfirmPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { address } = useTabWallet();
  const isConnected = !!address;

  const [action, setAction] = useState<PendingAction | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    void fetch(`/api/pending/${id}`)
      .then((r) => {
        if (!r.ok) { setNotFound(true); return null; }
        return r.json() as Promise<PendingAction>;
      })
      .then((data) => { if (data) setAction(data); })
      .finally(() => setLoading(false));
  }, [id]);

  const { run, hash, pending: isPending, done: isSuccess, error: errorMsg } = useAction();
  const isConfirming = false;

  function handleConfirm() {
    if (!action || !address) return;
    if (action.type === "send" && action.data.to) {
      const amount = BigInt(Math.round((action.data.amount ?? 0) * 1e6));
      // Signed by the user's own account, so the agent's daily limit doesn't apply here.
      void run([tabCall("send", [address, action.data.to, amount])]);
    }
  }

  // ── Loading ──────────────────────────────────────────────
  if (loading) {
    return (
      <AppShell>
        <Panel className="flex flex-col gap-6">
          <div className="flex flex-col items-center gap-3">
            <div className="skeleton h-4 w-24" />
            <div className="skeleton h-12 w-44" />
          </div>
          <div className="flex flex-col gap-3">
            <div className="skeleton h-10 w-full" />
            <div className="skeleton h-10 w-full" />
          </div>
          <div className="skeleton h-[52px] w-full rounded-full" />
        </Panel>
      </AppShell>
    );
  }

  // ── Not found ────────────────────────────────────────────
  if (notFound || !action) {
    return (
      <AppShell>
        <Panel className="flex flex-col items-center gap-5 py-10 text-center animate-slide-up">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-danger/10">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" strokeWidth="1.5" stroke="currentColor" strokeLinecap="round" className="text-danger">
              <circle cx="10" cy="10" r="8" />
              <path d="M10 6v5M10 14v.5" />
            </svg>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-[18px] font-semibold tracking-[-0.02em] text-ink">Link expired</p>
            <p className="text-[14px] text-muted">Text Tab again for a fresh link.</p>
          </div>
          <button onClick={() => void navigate("/")} className="btn btn-sm">
            Back to home
          </button>
        </Panel>
      </AppShell>
    );
  }

  const amountStr = action.data.amount?.toFixed(2) ?? "?";
  const toName = action.data.toName ?? action.data.recipient ?? "recipient";
  const typeLabel = action.type.charAt(0).toUpperCase() + action.type.slice(1);

  return (
    <AppShell>
      <div className="flex flex-col gap-6 animate-slide-up">
        <Panel className="flex flex-col gap-7 overflow-hidden">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-40"
            style={{ background: "radial-gradient(ellipse 70% 100% at 50% 0%, rgba(27,146,255,0.16), transparent 70%)" }}
            aria-hidden
          />
          <div className="relative flex flex-col items-center gap-4 pt-2 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-accent/25 bg-accent/10">
              <ShieldIcon />
            </div>
            <p className="kicker">Over your daily limit</p>
            <p className="mono text-[52px] font-medium leading-none tracking-[-0.045em] text-ink">
              {amountStr}
              <span className="ml-2 text-[18px] text-muted">USDC</span>
            </p>
            <div className="flex items-center gap-2 text-[15px] text-ink-2">
              <span className="text-muted">{typeLabel} to</span>
              <Monogram name={toName} size={24} />
              <span className="font-medium text-ink">{toName}</span>
            </div>
          </div>

          {!isConnected ? (
            <div className="relative">
              <SignIn verb="confirm" />
            </div>
          ) : isSuccess ? (
            <div className="relative flex flex-col items-center gap-4 animate-scale-in">
              <CheckIcon />
              <div className="flex flex-col items-center gap-1 text-center">
                <p className="text-[15px] font-medium text-success">Confirmed. It's on its way.</p>
                {hash && (
                  <a href={explorerTx(hash)} target="_blank" rel="noopener noreferrer" className="text-[13px] text-accent hover:underline">
                    View on Arc
                  </a>
                )}
              </div>
            </div>
          ) : (
            <div className="relative flex flex-col gap-3">
              <button onClick={handleConfirm} disabled={isPending || isConfirming} className="btn btn-primary btn-lg btn-block">
                {isPending ? "Sending..." : isConfirming ? "Submitting..." : "Confirm with Face ID"}
              </button>
              {errorMsg && <p className="text-center text-[13px] text-danger">{errorMsg}</p>}
            </div>
          )}
        </Panel>
        <p className="text-center text-[12.5px] text-faint">Only you can sign this. The agent can't.</p>
      </div>
    </AppShell>
  );
}
