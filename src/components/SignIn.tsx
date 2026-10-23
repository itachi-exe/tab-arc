import { useState } from "react";
import type React from "react";
import { ConnectKitButton } from "connectkit";
import { friendlyError, useTabWallet, PASSKEYS_ON } from "../lib/wallet";

function FaceIdIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
      <path d="M9 9.5v1M15 9.5v1M12 9.5v3.5h-1M9.5 15.5a3.5 3.5 0 0 0 5 0" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="5" stroke="rgba(255,255,255,0.3)" strokeWidth="2" />
      <path d="M7 2a5 5 0 0 1 5 5" stroke="white" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}


/**
 * Phone browsers (Safari, Chrome on iOS) have no wallet inside them, so the
 * ConnectKit sheet only offers a dead "Browser wallet". In that case we hand
 * the page to the MetaMask app instead: it opens this exact URL in its own
 * browser, where the wallet is injected and the normal connect just works.
 */
function hasInjected(): boolean {
  return typeof window !== "undefined" && Boolean((window as unknown as { ethereum?: unknown }).ethereum);
}

function metamaskLink(): string {
  const { host, pathname, search, hash } = window.location;
  return `https://metamask.app.link/dapp/${host}${pathname}${search}${hash}`;
}

function WalletButton({ label, className, style }: { label: string; className: string; style?: React.CSSProperties }) {
  if (!hasInjected()) {
    return (
      <a href={metamaskLink()} className={className} style={style}>
        {label === "Use a wallet" ? "Use MetaMask" : label.replace("Connect your wallet", "Open in MetaMask")}
      </a>
    );
  }
  return (
    <ConnectKitButton.Custom>
      {({ show }) => (
        <button type="button" onClick={show} className={className} style={style}>
          {label}
        </button>
      )}
    </ConnectKitButton.Custom>
  );
}

const primary = "btn btn-primary btn-lg btn-block";
const link = "rounded-md text-[13px] transition-colors duration-150 hover:text-ink";

/**
 * The only sign-in a Tab user ever sees: Face ID (or fingerprint).
 * "Use a wallet" stays as a quiet text link for people who already have one.
 */
export default function SignIn({ verb }: { verb?: string }) {
  const { knownDevice, createAccount, signIn, restoring } = useTabWallet();
  const [mode, setMode] = useState<"create" | "signin">(knownDevice ? "signin" : "create");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  if (restoring) {
    return (
      <button disabled className={primary}>
        <Spinner /> Signing you in
      </button>
    );
  }

  // Face ID needs a Circle client key. Without one, a wallet is the front door,
  // never a dead-end button that fails after you tap it.
  if (!PASSKEYS_ON) {
    return (
      <div className="flex flex-col gap-3">
        <WalletButton label={verb ? `Connect your wallet to ${verb}` : "Connect your wallet"} className={primary} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {mode === "create" ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => createAccount(name));
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your first name"
            autoComplete="given-name"
            maxLength={32}
            className="input"
          />
          <button type="submit" disabled={busy || name.trim().length === 0} className={primary}>
            {busy ? <Spinner /> : <FaceIdIcon />}
            {busy ? "Waiting for Face ID" : verb ? `Create your Tab to ${verb}` : "Create your Tab"}
          </button>
        </form>
      ) : (
        <button onClick={() => void run(signIn)} disabled={busy} className={primary}>
          {busy ? <Spinner /> : <FaceIdIcon />}
          {busy ? "Waiting for Face ID" : verb ? `Sign in with Face ID to ${verb}` : "Sign in with Face ID"}
        </button>
      )}

      {error && (
        <p className="text-center text-[13px] text-danger">
          {error}
        </p>
      )}

      <div className="flex items-center justify-center gap-4 pt-1">
        <button
          type="button"
          onClick={() => {
            setError(undefined);
            setMode(mode === "create" ? "signin" : "create");
          }}
          className={link}
          style={{ color: "var(--muted)" }}
        >
          {mode === "create" ? "I already have a Tab" : "New here? Create a Tab"}
        </button>
        <span style={{ color: "var(--subtle)" }} aria-hidden>
          ·
        </span>
        <WalletButton label="Use a wallet" className={link} style={{ color: "var(--subtle)" }} />
      </div>
      <p className="text-center text-[12px] text-faint">
        No app, no seed phrase. Your Face ID is the key.
      </p>
    </div>
  );
}
