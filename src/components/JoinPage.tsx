import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTabWallet, friendlyError } from "../lib/wallet";
import SignIn from "./SignIn";
import { AppShell, Panel, Kicker, prettyPhone } from "./ui";

const joinMessage = (username: string, phone: string, ts: number) =>
  `Link this wallet to Tab.\nUsername: @${username}\nPhone: ${phone}\nTime: ${ts}`;

const USERNAME_RE = /^[a-z][a-z0-9_]{2,19}$/;
const clean = (u: string) => u.trim().replace(/^@/, "").toLowerCase();

export default function JoinPage() {
  const { address, signMessage } = useTabWallet();
  const [username, setUsername] = useState("");
  const [owned, setOwned] = useState<string | null>(null);
  const [free, setFree] = useState<boolean | null>(null);
  const [phone, setPhone] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<{ line: string; code: string }>();
  const [linked, setLinked] = useState<string | null>(null);
  const navigate = useNavigate();

  // A wallet keeps one username. If it has one, that's the one.
  useEffect(() => {
    setTimeout(() => setOwned(null), 0);
    if (!address) return;
    fetch(`/api/username/${address}`).then((r) => r.json()).then((d: { username?: string | null }) => {
      if (d.username) { setOwned(d.username); setUsername(d.username); }
    }).catch(() => {});
  }, [address]);

  // A wallet with a username has already texted its code: it's linked. Go on to /me.
  useEffect(() => {
    if (owned && !result) navigate("/me", { replace: true });
  }, [owned, result, navigate]);

  // After the code is shown, watch for the text to land, then move on by itself.
  useEffect(() => {
    if (!result || !address || linked) return;
    const t = setInterval(() => {
      fetch(`/api/username/${address}`).then((r) => r.json()).then((d: { username?: string | null }) => {
        if (d.username) setLinked(d.username);
      }).catch(() => {});
    }, 2500);
    return () => clearInterval(t);
  }, [result, address, linked]);

  useEffect(() => {
    if (!linked) return;
    const t = setTimeout(() => navigate("/me", { replace: true }), 1400);
    return () => clearTimeout(t);
  }, [linked, navigate]);

  const u = clean(username);
  const shapeOk = USERNAME_RE.test(u);

  // Availability, checked as you type.
  useEffect(() => {
    setTimeout(() => setFree(null), 0);
    if (!shapeOk || owned === u) return;
    const t = setTimeout(() => {
      fetch(`/api/username-free/${u}?address=${address ?? ""}`).then((r) => r.json()).then((d: { free?: boolean }) => setFree(!!d.free)).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [u, shapeOk, owned, address]);

  const hint = !u ? "" : !shapeOk ? "3 to 20 letters, numbers or _." : owned === u ? "This is your username." : free === false ? `@${u} is taken.` : free ? `@${u} is free.` : "";
  const usable = shapeOk && (owned === u || free === true);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    if (!address || pending || !usable) return;
    setPending(true);
    setError(undefined);
    try {
      const cleanPhone = phone.replace(/[^\d+]/g, "").replace(/^(?!\+)/, "+");
      const ts = Date.now();
      const signature = await signMessage(joinMessage(u, cleanPhone, ts));
      const r = await fetch("/api/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, username: u, phone: cleanPhone, ts, signature }),
      });
      const d = (await r.json()) as { line?: string; code?: string; error?: string };
      if (!r.ok || !d.code || !d.line) throw new Error(d.error ?? "That didn't go through. Try again.");
      setResult({ line: d.line, code: d.code });
    } catch (err) {
      const m = err instanceof Error ? err.message : "";
      setError(/[.]$/.test(m) && !/NOT_SIGNED_IN|User rejected|denied|NotAllowed/i.test(m) ? m : friendlyError(err));
    } finally {
      setPending(false);
    }
  }

  const body = result ? `join ${result.code}` : "";
  const href = result ? `sms:${result.line}&body=${encodeURIComponent(body)}` : "";

  return (
    <AppShell>
      <div className="flex flex-col gap-5 animate-slide-up">
        <Panel className="relative overflow-hidden">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <Kicker>iMessage</Kicker>
              <h1 className="text-[30px] font-semibold leading-[1.1] tracking-[-0.035em] text-ink">
                {linked ? `You're in, @${linked}.` : result ? "Text this code to Tab." : "Text your money."}
              </h1>
              <p className="text-[15px] text-muted">
                {linked ? "Taking you to your Tab." : result ? "Send it, this page moves on by itself." : "Link your number once. Then just text."}
              </p>
            </div>

            {!address ? (
              <SignIn verb="link your number" />
            ) : result ? (
              <div className="flex flex-col gap-5 animate-scale-in">
                <div className="rounded-card border border-line bg-white/[0.03] px-5 py-6 text-center">
                  <p className="mono text-[40px] font-medium leading-none tracking-[0.18em] text-ink">{result.code}</p>
                  <p className="mt-3 text-[13px] text-muted">
                    to <span className="mono tabular-nums text-ink-2">{prettyPhone(result.line)}</span>
                  </p>
                </div>
                <a href={href} className="btn btn-primary btn-lg btn-block">
                  Text Tab
                </a>
                <p className="text-center text-[12.5px] text-faint">On a computer? Text "{body}" from your iPhone.</p>
              </div>
            ) : (
              <form onSubmit={(e) => void start(e)} className="flex flex-col gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[13px] text-muted">Username</span>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[15px] text-faint">@</span>
                    <input
                      className="input mono pl-8"
                      value={username}
                      onChange={(e) => setUsername(e.target.value.replace(/[^A-Za-z0-9_@]/g, "").toLowerCase())}
                      readOnly={!!owned}
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      autoComplete="username"
                      maxLength={21}
                      placeholder="jay"
                      required
                    />
                  </div>
                  <span className={`min-h-[18px] text-[12.5px] ${free === false || (u && !shapeOk) ? "text-danger" : "text-faint"}`}>{hint || "People pay you by this."}</span>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[13px] text-muted">iPhone number</span>
                  <input
                    className="input mono tabular-nums"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="+1 415 555 0100"
                    required
                  />
                </label>
                <button type="submit" disabled={pending || !usable || phone.replace(/\D/g, "").length < 8} className="btn btn-primary btn-lg btn-block mt-2">
                  {pending ? "Check your wallet..." : "Get my code"}
                </button>
                {error && <p className="text-center text-[13px] text-danger">{error}</p>}
              </form>
            )}
          </div>
        </Panel>
        <p className="text-center text-[12.5px] text-faint">Your number stays off the chain.</p>
      </div>
    </AppShell>
  );
}
