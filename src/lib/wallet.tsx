/**
 * Tab wallet: a passkey smart account (Face ID / fingerprint) via Circle Modular
 * Wallets, with an existing browser wallet as a quiet fallback.
 *
 * Every page talks to this one hook, so a page never cares which kind of
 * account is signed in. Gas is sponsored through Circle Gas Station
 * (paymaster: true), so a passkey user never needs to hold anything but USDC.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPublicClient, type Hex } from "viem";
import { createBundlerClient, toWebAuthnAccount, type SmartAccount } from "viem/account-abstraction";
import {
  WebAuthnMode,
  toCircleSmartAccount,
  toModularTransport,
  toPasskeyTransport,
  toWebAuthnCredential,
  type WebAuthnCredential,
} from "@circle-fin/modular-wallets-core";
import { useAccount, useDisconnect, usePublicClient, useWalletClient } from "wagmi";
import { ARC_CHAIN, ARC_NETWORK, IS_TESTNET } from "./network";

const WALLET_LOW_MSG = IS_TESTNET
  ? "Not enough USDC in your wallet. Get testnet USDC at faucet.circle.com."
  : "Not enough USDC in your wallet. Add USDC on Arc first.";

export type Call = { to: Hex; data: Hex };

const CLIENT_KEY = (import.meta.env.VITE_CLIENT_KEY ?? "") as string;
const CLIENT_URL = (import.meta.env.VITE_CLIENT_URL ?? "https://modular-sdk.circle.com/v1/rpc/w3s/buidl") as string;
export const PASSKEYS_ON = CLIENT_KEY.length > 0;

// The stored credential is the passkey's public half (id + public key). It can't
// sign anything: every signature still needs Face ID on the device that holds it.
const STORE = "tab.passkey.v1";

type Stored = { credential: WebAuthnCredential; name: string };

function readStored(): Stored | null {
  try {
    const raw = localStorage.getItem(STORE);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

const circle = PASSKEYS_ON
  ? (() => {
      const modular = toModularTransport(`${CLIENT_URL}/${ARC_NETWORK}`, CLIENT_KEY);
      return {
        passkey: toPasskeyTransport(CLIENT_URL, CLIENT_KEY),
        client: createPublicClient({ chain: ARC_CHAIN, transport: modular }),
        bundler: createBundlerClient({ chain: ARC_CHAIN, transport: modular }),
      };
    })()
  : null;

async function smartAccountFor(credential: WebAuthnCredential, name?: string): Promise<SmartAccount> {
  if (!circle) throw new Error("PASSKEYS_OFF");
  return toCircleSmartAccount({
    client: circle.client,
    owner: toWebAuthnAccount({ credential }),
    name,
  });
}

export type WalletKind = "passkey" | "wallet" | null;

interface TabWallet {
  address?: Hex;
  kind: WalletKind;
  name?: string;
  restoring: boolean;
  /** A passkey for this device was used here before, so "Sign in" makes sense. */
  knownDevice: boolean;
  createAccount: (name: string) => Promise<void>;
  signIn: () => Promise<void>;
  signOut: () => void;
  /** Runs the calls as one action (one Face ID prompt), waits for the chain, returns the tx hash. */
  send: (calls: Call[]) => Promise<Hex>;
  /** Signs a plain message, proving this wallet is yours. Moves nothing. */
  signMessage: (message: string) => Promise<Hex>;
}

const Ctx = createContext<TabWallet | null>(null);

export function TabWalletProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<SmartAccount | null>(null);
  const [name, setName] = useState<string>();
  const [restoring, setRestoring] = useState(() => PASSKEYS_ON && readStored() !== null);
  const [knownDevice, setKnownDevice] = useState(() => readStored() !== null);
  const inFlight = useRef(false);

  const wagmiAccount = useAccount();
  const { disconnect } = useDisconnect();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient({ chainId: ARC_CHAIN.id });

  // Restore a passkey session on reload. No prompt: building the account only needs the public key.
  useEffect(() => {
    const stored = readStored();
    if (!PASSKEYS_ON || !stored) return;
    smartAccountFor(stored.credential, stored.name)
      .then((a) => {
        setAccount(a);
        setName(stored.name);
      })
      .catch(() => undefined)
      .finally(() => setRestoring(false));
  }, []);

  const adopt = useCallback(async (credential: WebAuthnCredential, label: string) => {
    const a = await smartAccountFor(credential, label);
    localStorage.setItem(STORE, JSON.stringify({ credential, name: label } satisfies Stored));
    setAccount(a);
    setName(label);
    setKnownDevice(true);
  }, []);

  const createAccount = useCallback(
    async (label: string) => {
      if (!circle) throw new Error("PASSKEYS_OFF");
      const clean = label.trim().slice(0, 32) || "Tab";
      const credential = await toWebAuthnCredential({
        transport: circle.passkey,
        mode: WebAuthnMode.Register,
        username: `${clean} (Tab)`,
      });
      await adopt(credential, clean);
    },
    [adopt],
  );

  const signIn = useCallback(async () => {
    if (!circle) throw new Error("PASSKEYS_OFF");
    const credential = await toWebAuthnCredential({ transport: circle.passkey, mode: WebAuthnMode.Login });
    await adopt(credential, readStored()?.name ?? "You");
  }, [adopt]);

  const signOut = useCallback(() => {
    // Keep nothing that could be mistaken for a session. The passkey itself stays on the device.
    localStorage.removeItem(STORE);
    setAccount(null);
    setName(undefined);
    if (wagmiAccount.isConnected) disconnect();
  }, [disconnect, wagmiAccount.isConnected]);

  const send = useCallback(
    async (calls: Call[]): Promise<Hex> => {
      if (calls.length === 0) throw new Error("NO_CALLS");
      // One action at a time: a double tap must never become a double payment.
      if (inFlight.current) throw new Error("BUSY");
      inFlight.current = true;
      try {
        if (account && circle) {
          const hash = await circle.bundler.sendUserOperation({ account, calls, paymaster: true });
          const { receipt, success } = await circle.bundler.waitForUserOperationReceipt({ hash });
          if (!success) throw new Error("REVERTED");
          return receipt.transactionHash;
        }
        if (walletClient && publicClient && wagmiAccount.address) {
          if (wagmiAccount.chainId !== ARC_CHAIN.id) {
            try {
              await walletClient.switchChain({ id: ARC_CHAIN.id });
            } catch (e) {
              // Most wallets don't ship Arc yet: add it once, then switch.
              const code = (e as { code?: number; cause?: { code?: number } })?.code ?? (e as { cause?: { code?: number } })?.cause?.code;
              const msg = String((e as Error)?.message ?? "");
              if (code !== 4902 && !/unrecognized|not added|unknown chain|wallet_addEthereumChain/i.test(msg)) throw e;
              await walletClient.addChain({ chain: ARC_CHAIN });
              await walletClient.switchChain({ id: ARC_CHAIN.id });
            }
          }
          let last: Hex = "0x";
          for (const c of calls) {
            // Simulate first so a call that would revert never asks for a signature.
            await publicClient.call({ account: wagmiAccount.address, to: c.to, data: c.data });
            last = await walletClient.sendTransaction({ account: wagmiAccount.address, chain: ARC_CHAIN, to: c.to, data: c.data });
            const r = await publicClient.waitForTransactionReceipt({ hash: last });
            if (r.status !== "success") throw new Error("REVERTED");
          }
          return last;
        }
        throw new Error("NOT_SIGNED_IN");
      } catch (e) {
        reportError(e);
        throw e;
      } finally {
        inFlight.current = false;
      }
    },
    [account, walletClient, publicClient, wagmiAccount.address, wagmiAccount.chainId],
  );

  const signMessage = useCallback(
    async (message: string): Promise<Hex> => {
      if (account) return account.signMessage({ message });
      if (walletClient && wagmiAccount.address) return walletClient.signMessage({ account: wagmiAccount.address, message });
      throw new Error("NOT_SIGNED_IN");
    },
    [account, walletClient, wagmiAccount.address],
  );

  const value = useMemo<TabWallet>(() => {
    const kind: WalletKind = account ? "passkey" : wagmiAccount.isConnected ? "wallet" : null;
    return {
      address: account?.address ?? wagmiAccount.address,
      kind,
      name,
      restoring,
      knownDevice,
      createAccount,
      signIn,
      signOut,
      send,
      signMessage,
    };
  }, [account, wagmiAccount.isConnected, wagmiAccount.address, name, restoring, knownDevice, createAccount, signIn, signOut, send, signMessage]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTabWallet(): TabWallet {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTabWallet outside TabWalletProvider");
  return v;
}

/** Sends the raw failure to the server log so a vague error on a phone is never a mystery. */
function reportError(e: unknown) {
  try {
    const err = e as { name?: string; code?: number; shortMessage?: string; message?: string; details?: string };
    const body = JSON.stringify({
      name: err?.name,
      code: err?.code,
      msg: String(err?.shortMessage ?? err?.message ?? e).slice(0, 400),
      details: String(err?.details ?? "").slice(0, 300),
      ua: navigator.userAgent.slice(0, 160),
      wallet: (window as unknown as { ethereum?: Record<string, unknown> }).ethereum ? Object.keys((window as unknown as { ethereum: Record<string, unknown> }).ethereum).filter((k) => /^is[A-Z]/.test(k)).join(",") : "none",
    });
    void fetch("/api/client-error", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => undefined);
  } catch {
    /* never let reporting break the app */
  }
}

/** One short line that ends in the fix. */
export function friendlyError(e: unknown): string {
  const name = (e as { name?: string })?.name ?? "";
  const msg = e instanceof Error ? e.message : typeof e === "string" ? e : ((e as { message?: string } | null)?.message ?? "");
  if (name === "NotAllowedError" || /NotAllowed|cancel|timed out/i.test(msg)) return "Face ID was cancelled. Tap again to retry.";
  if (name === "InvalidStateError") return "This device already has a Tab. Sign in instead.";
  if (name === "SecurityError") return "Face ID isn't allowed on this site yet. Try again later.";
  if (msg === "PASSKEYS_OFF") return "Face ID sign-in isn't switched on yet. Use a wallet for now.";
  if (msg === "BUSY") return "Still working on the last one. Give it a second.";
  if (msg === "NOT_SIGNED_IN") return "You're signed out. Sign in and tap again.";
  if (msg === "WALLET_LOW") return WALLET_LOW_MSG;
  if (/exceeds balance|ERC20InsufficientBalance|insufficient funds/i.test(msg)) return WALLET_LOW_MSG;
  if (/InsufficientBalance|insufficient/i.test(msg)) return "Not enough USDC. Add funds first.";
  if (/chain|network/i.test(msg) && /switch|unrecognized|unsupported|mismatch/i.test(msg)) return `Switch your wallet to ${IS_TESTNET ? "Arc Testnet" : "Arc"}, then tap again.`;
  if (/OverDailyLimit|DailyLimit/i.test(msg)) return "Over your daily limit. Confirm it from your Tab.";
  if (/ClaimAlreadyUsed/i.test(msg)) return "Already claimed or refunded.";
  if (/AA33|paymaster/i.test(msg)) return "Gas sponsor is offline. Try again in a minute.";
  if (/User rejected|denied|4001/i.test(msg) || (e as { code?: number })?.code === 4001) return "You declined it in your wallet. Tap again to retry.";
  if (/HTTP request failed|Failed to fetch|NetworkError|timed? ?out/i.test(msg + " " + String((e as { details?: string })?.details ?? ""))) return "Couldn't reach Arc. Check your connection and tap again.";
  return "That didn't go through. Try again.";
}

/** A single on-chain action with its own pending, done and error state. */
export function useAction() {
  const { send } = useTabWallet();
  const [hash, setHash] = useState<Hex>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const run = useCallback(
    async (calls: Call[] | (() => Promise<Call[]>)) => {
      setPending(true);
      setError(undefined);
      try {
        const list = typeof calls === "function" ? await calls() : calls;
        setHash(await send(list));
      } catch (e) {
        setError(friendlyError(e));
      } finally {
        setPending(false);
      }
    },
    [send],
  );
  return { run, hash, pending, done: hash !== undefined, error };
}
