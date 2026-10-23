/**
 * Tab backend. Express app, served as one Vercel function at /api/*.
 *
 * Safety model:
 * - Only a trusted relay (our iMessage line, holding IMESSAGE_RELAY_SECRET) can
 *   act for a phone number. Anyone else, including the public /try page, gets
 *   preview replies and nothing touches the chain.
 * - The AI only proposes. Amounts and names are checked against the user's own
 *   words, and the contract's daily limit is the final wall.
 * - Over the limit, the user signs it themselves on /confirm.
 * - "Sent" is only said after the chain confirms the transaction.
 */

import express, { type Request } from "express";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { parseIntent, llmProvider } from "./llm.js";
import {
  findByHandle,
  findByUsername,
  nearestUsername,
  upsertContact,
  usernameOf,
  usernameTaken,
  usernameOk,
  cleanUsername,
} from "./db.js";
import {
  getBalance,
  sendFunds,
  sendToClaim,
  createSplit,
  createHold,
  releaseHold,
  holdPayer,
  agentHeadroom,
  shortExplorerLink,
  verifySigned,
  walletUsdc,
  TAB_ADDRESS,
} from "./chain.js";
import { storeJoin, takeJoin } from "./db.js";
import { photonOn, registerNumber, TAB_LINE } from "./photon.js";

const APP_URL = process.env.APP_URL ?? "https://tab-arc.vercel.app";
const PENDING_TTL_MS = 15 * 60_000;
const usdc = (raw: bigint) => (Number(raw) / 1e6).toFixed(2);
const toRaw = (n: number) => BigInt(Math.round(n * 1e6));

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "8kb" }));
// On Vercel the request keeps its /api prefix; locally Vite strips it.
app.use((req, _res, next) => {
  if (req.url.startsWith("/api/")) req.url = req.url.slice(4);
  else if (req.url === "/api") req.url = "/";
  next();
});

// ── Guards ────────────────────────────────────────────────────────────────────
function secretOk(req: Request, header: string, envName: string): boolean {
  const expected = process.env[envName] ?? "";
  const got = String(req.headers[header] ?? "");
  if (expected.length < 24 || got.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

const hits = new Map<string, number[]>();
function rateLimited(key: string, max = 20, windowMs = 60_000): boolean {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(key, list);
  return list.length > max;
}

// Same message delivered twice (relay retry) must never pay twice.
const seen = new Map<string, { at: number; reply: string }>();
// One money action per handle at a time.
const busy = new Set<string>();

// ── Health ────────────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ ok: true, live: Boolean(TAB_ADDRESS), parser: llmProvider });
});

// ── Balance ───────────────────────────────────────────────────────────────────
app.get("/balance/:address", async (req, res) => {
  if (!/^0x[0-9a-fA-F]{40}$/.test(req.params.address)) {
    res.status(400).json({ error: "Bad address." });
    return;
  }
  try {
    res.json({ balance: usdc(await getBalance(req.params.address)) });
  } catch {
    res.status(502).json({ error: "Balance unavailable. Try again shortly." });
  }
});

// ── Wallet USDC (outside Tab), so /me can say "your wallet is empty" up front ──
app.get("/wallet-usdc/:address", async (req, res) => {
  if (!/^0x[0-9a-fA-F]{40}$/.test(req.params.address)) {
    res.status(400).json({ error: "Bad address." });
    return;
  }
  try {
    const raw = (await walletUsdc(req.params.address as `0x${string}`)) as bigint;
    res.json({ raw: raw.toString() });
  } catch {
    res.status(502).json({ error: "Unavailable." });
  }
});

// ── Client errors: raw wallet failures from phones, logged short, no PII ─────
app.post("/client-error", (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const s = (v: unknown, n: number) => String(v ?? "").replace(/0x[0-9a-fA-F]{40}/g, "0x…").slice(0, n);
  console.log("[client-error]", JSON.stringify({ name: s(b.name, 40), code: s(b.code, 12), msg: s(b.msg, 400), details: s(b.details, 300), wallet: s(b.wallet, 80), ua: s(b.ua, 160) }));
  res.json({ ok: true });
});

// ── RPC relay: the browser reads Arc through us, so a blocked or flaky public
// RPC on someone's network never breaks the app. Read-only methods only.
const RPC_READ = new Set([
  "eth_chainId", "eth_blockNumber", "eth_call", "eth_estimateGas", "eth_gasPrice",
  "eth_maxPriorityFeePerGas", "eth_feeHistory", "eth_getBalance", "eth_getCode",
  "eth_getTransactionCount", "eth_getTransactionByHash", "eth_getTransactionReceipt",
  "eth_getBlockByNumber", "eth_getBlockByHash", "eth_getLogs", "eth_getStorageAt", "net_version",
]);
const RPC_UPSTREAMS = (process.env.ARC_NETWORK === "arcTestnet"
  ? ["https://rpc.testnet.arc.io", "https://rpc.drpc.testnet.arc.io", "https://rpc.quicknode.testnet.arc.io", "https://rpc.blockdaemon.testnet.arc.io"]
  : ["https://rpc.mainnet.arc.io", "https://rpc.drpc.mainnet.arc.io", "https://rpc.quicknode.mainnet.arc.io", "https://rpc.blockdaemon.mainnet.arc.io"]);
app.post("/rpc", async (req, res) => {
  const b = req.body as { method?: unknown; id?: unknown } | unknown[];
  if (Array.isArray(b) || typeof b?.method !== "string" || !RPC_READ.has(b.method)) {
    res.status(400).json({ jsonrpc: "2.0", id: (b as { id?: unknown })?.id ?? null, error: { code: -32601, message: "Method not allowed" } });
    return;
  }
  const body = JSON.stringify(b);
  for (const url of RPC_UPSTREAMS) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      res.type("application/json").send(await r.text());
      return;
    } catch {
      /* next upstream */
    }
  }
  res.status(502).json({ jsonrpc: "2.0", id: (b as { id?: unknown }).id ?? null, error: { code: -32603, message: "Arc RPC unavailable" } });
});

// ── Contacts: admin only. Phone numbers never leave the server. ──────────────
app.post("/contacts", (req, res) => {
  if (!secretOk(req, "x-tab-admin-secret", "TAB_ADMIN_SECRET")) {
    res.status(401).json({ error: "Not allowed." });
    return;
  }
  const { handle, address } = req.body as { handle?: string; address?: string };
  const username = cleanUsername((req.body as { username?: string }).username ?? "");
  if (!handle || !usernameOk(username) || !address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    res.status(400).json({ error: "handle, a valid username and a valid address required" });
    return;
  }
  if (usernameTaken(username, address)) {
    res.status(409).json({ error: "Username taken." });
    return;
  }
  const existing = findByHandle(handle);
  if (existing && existing.address.toLowerCase() !== address.toLowerCase()) {
    // Rebinding a number to a new wallet is how funds get hijacked. Never silently.
    res.status(409).json({ error: "Handle already linked to another wallet." });
    return;
  }
  upsertContact({ handle, address, username });
  res.json({ ok: true });
});

// ── Join: link your number to your wallet ───────────────────────────────────
// The wallet signs the request, and texting the code from your phone proves the
// number. Both are needed, so nobody can point their number at your money.
export const joinMessage = (username: string, phone: string, ts: number) =>
  `Link this wallet to Tab.\nUsername: @${username}\nPhone: ${phone}\nTime: ${ts}`;
const CODE_ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const joinCode = () => Array.from(randomBytes(6), (b) => CODE_ABC[b % CODE_ABC.length]).join("");

// The username a wallet already owns, so /join and /me can show it.
app.get("/username/:address", (req, res) => {
  if (!/^0x[0-9a-fA-F]{40}$/.test(req.params.address)) return void res.status(400).json({ error: "Bad address." });
  res.json({ username: usernameOf(req.params.address) ?? null });
});

// Live availability check while typing. Says nothing about who owns it.
app.get("/username-free/:username", (req, res) => {
  const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0];
  if (rateLimited(`ufree:${ip}`, 60)) return void res.status(429).json({ error: "Slow down." });
  const u = cleanUsername(req.params.username);
  const addr = String(req.query.address ?? "");
  const mine = /^0x[0-9a-fA-F]{40}$/.test(addr) ? addr : "0x0000000000000000000000000000000000000000";
  res.json({ ok: usernameOk(u), free: usernameOk(u) && !usernameTaken(u, mine) });
});

app.get("/line", (_req, res) => {
  res.json({ on: photonOn, line: TAB_LINE || null });
});

app.post("/join", async (req, res) => {
  const { address, username, phone, ts, signature } = req.body as { address?: string; username?: string; phone?: string; ts?: number; signature?: string };
  const cleanName = cleanUsername(username ?? "");
  const cleanPhone = String(phone ?? "").replace(/[^\d+]/g, "");
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) return void res.status(400).json({ error: "Connect your wallet first." });
  if (!usernameOk(cleanName)) return void res.status(400).json({ error: "Pick a username: 3 to 20 letters, numbers or _." });
  if (!/^\+[1-9]\d{7,14}$/.test(cleanPhone)) return void res.status(400).json({ error: "Add your number with the country code, like +1 415 555 0100." });
  if (typeof ts !== "number" || Math.abs(Date.now() - ts) > 10 * 60_000) return void res.status(400).json({ error: "That took too long. Tap again." });
  if (typeof signature !== "string" || !signature.startsWith("0x")) return void res.status(400).json({ error: "Sign in your wallet to continue." });
  const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0];
  if (rateLimited(`join:${ip}`, 6, 10 * 60_000)) return void res.status(429).json({ error: "Too many tries. Wait a few minutes." });
  if (!photonOn) return void res.status(503).json({ error: "Texting opens soon. Use /me for now." });
  const owned = usernameOf(address);
  if (owned && owned !== cleanName) return void res.status(409).json({ error: `This wallet is already @${owned}.` });
  if (usernameTaken(cleanName, address)) return void res.status(409).json({ error: `@${cleanName} is taken. Try another.` });

  if (!(await verifySigned(address, joinMessage(cleanName, cleanPhone, ts), signature as `0x${string}`))) {
    return void res.status(401).json({ error: "That signature didn't match. Tap again." });
  }
  try {
    const line = await registerNumber(cleanPhone, cleanName);
    const code = joinCode();
    storeJoin({ code, address, username: cleanName, phone: cleanPhone, createdAt: Date.now() });
    res.json({ line, code });
  } catch (err) {
    console.error("join_error", String(err).slice(0, 300));
    res.status(502).json({ error: "Couldn't reach the iMessage line. Try again in a minute." });
  }
});

// ── Pending action links (for /confirm) ───────────────────────────────────────
// The link itself carries the action, signed by the server. No database, so a
// cold serverless instance can still open it. The user signs the real
// transaction on /confirm, so the token only decides what the screen shows.
const linkSecret = () => process.env.TAB_LINK_SECRET || process.env.IMESSAGE_RELAY_SECRET || "";
const b64 = (s: string) => Buffer.from(s).toString("base64url");
const sign = (body: string) => createHmac("sha256", linkSecret()).update(body).digest("base64url").slice(0, 32);

function readLink(token: string): { id: string; type: string; data: Record<string, unknown>; createdAt: number } | null {
  const [body, sig] = token.split(".");
  if (!body || !sig || linkSecret().length < 24) return null;
  const want = sign(body);
  if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try {
    const a = JSON.parse(Buffer.from(body, "base64url").toString()) as { type: string; data: Record<string, unknown>; createdAt: number };
    if (Date.now() - a.createdAt > PENDING_TTL_MS) return null;
    return { id: token, type: a.type, data: a.data, createdAt: a.createdAt };
  } catch {
    return null;
  }
}

app.get("/pending/:id", (req, res) => {
  const action = readLink(req.params.id);
  if (!action) {
    res.status(404).json({ error: "This link expired. Text Tab again." });
    return;
  }
  res.json(action);
});

// ── Message handling ──────────────────────────────────────────────────────────
function confirmLink(data: Record<string, unknown>): string {
  const body = b64(JSON.stringify({ type: "send", data, createdAt: Date.now(), n: randomBytes(6).toString("hex") }));
  return `${APP_URL}/confirm/${body}.${sign(body)}`;
}

function friendlyError(err: unknown): string {
  const m = String(err);
  if (m.includes("InsufficientBalance")) return "Not enough USDC. Add funds on /me first.";
  if (m.includes("OverDailyLimit")) return "That's over today's limit. Text it again for a confirm link.";
  if (m.includes("AgentBlocked")) return "Texting is paused for your account. Turn it on in /me.";
  if (m.includes("HoldAlreadyUsed")) return "That hold is already settled.";
  if (m.includes("TAB_NOT_DEPLOYED")) return "Tab isn't live on Arc yet. Nothing moved.";
  return "Nothing moved. Try again in a minute.";
}

async function handle(from: string, text: string, live: boolean): Promise<string> {
  const join = live ? text.trim().match(/^join\s+([A-Za-z0-9]{6})$/i) : null;
  if (join) {
    const j = takeJoin(join[1]);
    if (!j) return `That code expired. Get a new one at ${APP_URL}/join`;
    if (usernameTaken(j.username, j.address)) return `@${j.username} was just taken. Pick another at ${APP_URL}/join`;
    upsertContact({ handle: from, address: j.address, username: j.username });
    return `You're in, @${j.username}. Try: balance`;
  }

  const intent = await parseIntent(text);

  if (intent.action === "unknown") {
    return "Didn't catch that. Try: send 20 to @jay, split 30 with @jay and @kira, or balance.";
  }

  // Preview: the public demo. Reads back what Tab would do, moves nothing.
  if (!live || !TAB_ADDRESS) {
    const who = intent.recipients?.join(" and ") ?? "them";
    const what: Record<string, string> = {
      send: `Got it: send ${intent.amount} USDC to ${who}.`,
      split: `Got it: split ${intent.amount} USDC with ${who}.`,
      hold: `Got it: hold ${intent.amount} USDC for ${who}.`,
      balance: "Got it: balance check.",
      release: "Got it: release that hold.",
    };
    return `${what[intent.action] ?? "Got it."} This is a preview, nothing moved.`;
  }

  const sender = findByHandle(from);
  if (!sender) return `Link this number first: ${APP_URL}/join`;

  switch (intent.action) {
    case "balance":
      return `You have ${usdc(await getBalance(sender.address))} USDC.`;

    case "deposit":
    case "withdraw":
      // Moving money in or out of Tab is always signed by the user, never by text.
      return `Open ${APP_URL}/me to ${intent.action}. You sign it with Face ID.`;

    case "send": {
      const amount = toRaw(intent.amount!);
      const name = cleanUsername(intent.recipients![0]);
      const target = findByUsername(name);
      if (target && target.address.toLowerCase() === sender.address.toLowerCase()) return "That's you. Send to someone else.";
      const matches = target ? [target] : [];

      const bal = await getBalance(sender.address);
      if (bal < amount) return `You have ${usdc(bal)} USDC. Add funds on /me first.`;

      const room = await agentHeadroom(sender.address);
      if (room.disabled) return "Texting is paused for your account. Turn it on in /me.";

      if (matches.length === 0) {
        // Unknown username: refuse. A typo must never lock real money in a claim.
        // Claim links only for a phone number, which nobody types by accident.
        const raw = String(intent.recipients![0]).replace(/[\s().-]/g, "");
        if (!/^\+?\d{7,15}$/.test(raw)) {
          const near = nearestUsername(name);
          return near
            ? `No one on Tab is @${name}. Did you mean @${near}? Send again with that.`
            : `No one on Tab is @${name}. Check the username.`;
        }
        // No wallet: lock it in a claim. The one-time key goes in the link's #fragment
        // and is never stored here, so not even this server can claim it later.
        if (amount > room.left) return "Over today's limit. Send less, or raise your limit on /me.";
        const key = generatePrivateKey();
        const claimId = `0x${randomBytes(32).toString("hex")}` as `0x${string}`;
        await sendToClaim(sender.address, claimId, amount, privateKeyToAccount(key).address);
        return `${intent.amount} USDC is waiting for ${raw}. They're not on Tab yet, so forward them this: ${APP_URL}/claim/${claimId.slice(2)}#k=${key}`;
      }

      const to = matches[0];
      if (amount > room.left) {
        return `Over today's limit. Confirm with Face ID: ${confirmLink({ to: to.address, toName: `@${to.username}`, amount: intent.amount })}`;
      }
      const hash = await sendFunds(sender.address, to.address, amount);
      return `Sent ${intent.amount} USDC to @${to.username}. View on Arc: ${shortExplorerLink(hash)}`;
    }

    case "split": {
      const resolved: Array<{ name: string; address: string }> = [];
      for (const n of intent.recipients!) {
        const c = findByUsername(n);
        if (!c) return `No one on Tab is @${cleanUsername(n)}. Check the username, then split again.`;
        if (c.address.toLowerCase() === sender.address.toLowerCase()) continue;
        if (!resolved.some((r) => r.address.toLowerCase() === c.address.toLowerCase())) resolved.push({ name: `@${c.username}`, address: c.address });
      }
      if (resolved.length === 0) return "Split with who? Name at least one other person.";
      // Integer math: each person's share, creator pays their own part.
      const share = toRaw(intent.amount!) / BigInt(resolved.length + 1);
      if (share === 0n) return "That amount is too small to split.";
      const splitId = `0x${randomBytes(32).toString("hex")}` as `0x${string}`;
      await createSplit(splitId, sender.address, resolved.map((r) => r.address), resolved.map(() => share));
      const owe = resolved.length === 1 ? "owes" : "each owe";
      return `${resolved.map((r) => r.name).join(" and ")} ${owe} ${usdc(share)} USDC. Pay link: ${APP_URL}/split/${splitId.slice(2)}`;
    }

    case "hold": {
      const amount = toRaw(intent.amount!);
      const who = findByUsername(intent.recipients![0]);
      if (!who) return `No one on Tab is @${cleanUsername(intent.recipients![0])}. Check the username.`;
      if (who.address.toLowerCase() === sender.address.toLowerCase()) return "That's you. Hold for someone else.";
      const m = [who];
      const deadline = Math.min(intent.deadline ? Date.parse(intent.deadline) : Date.now() + 7 * 86_400_000, Date.now() + 90 * 86_400_000);
      const room = await agentHeadroom(sender.address);
      if (room.disabled) return "Texting is paused for your account. Turn it on in /me.";
      if (amount > room.left) return "Over today's limit. Hold less, or raise your limit on /me.";
      const holdId = `0x${randomBytes(32).toString("hex")}` as `0x${string}`;
      const hash = await createHold(holdId, sender.address, m[0].address, amount, BigInt(Math.floor(deadline / 1000)));
      return `Holding ${intent.amount} USDC for @${m[0].username}. Text "release ${holdId.slice(2)}" when done. ${shortExplorerLink(hash)}`;
    }

    case "release": {
      const holdId = `0x${intent.holdId}` as `0x${string}`;
      // The agent may release any hold on-chain, so the check that it's yours lives here.
      if ((await holdPayer(holdId)).toLowerCase() !== sender.address.toLowerCase()) return "That hold isn't yours to release.";
      const hash = await releaseHold(holdId);
      return `Released. View on Arc: ${shortExplorerLink(hash)}`;
    }
  }
  return "Didn't catch that. Try: send 20 to @jay.";
}

async function onMessage(req: Request, res: express.Response, live: boolean) {
  const { from, text, messageId } = req.body as { from?: string; text?: string; messageId?: string };
  if (typeof from !== "string" || typeof text !== "string" || !from || !text.trim() || from.length > 128) {
    res.status(400).json({ error: "from and text are required" });
    return;
  }
  const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0];
  if (rateLimited(`ip:${ip}`, live ? 120 : 20) || rateLimited(`from:${from}`, 20)) {
    res.status(429).json({ reply: "Slow down a little. Try again in a minute." });
    return;
  }

  const dedupeKey = messageId ? `${from}:${messageId}` : "";
  const prior = dedupeKey ? seen.get(dedupeKey) : undefined;
  if (prior) {
    res.json({ reply: prior.reply });
    return;
  }
  if (live && busy.has(from)) {
    res.json({ reply: "Still finishing your last one. Text again in a few seconds." });
    return;
  }

  if (live) busy.add(from);
  try {
    const reply = await handle(from, text.trim(), live);
    if (dedupeKey) seen.set(dedupeKey, { at: Date.now(), reply });
    res.json({ reply });
  } catch (err) {
    console.error("tab_error", String(err).slice(0, 300));
    res.json({ reply: friendlyError(err) });
  } finally {
    busy.delete(from);
    for (const [k, v] of seen) if (Date.now() - v.at > 10 * 60_000) seen.delete(k);
  }
}

// Public: the /try demo. Always preview, never moves money.
app.post("/message", (req, res) => void onMessage(req, res, false));

// Trusted: our iMessage relay. Only it can speak for a phone number.
app.post("/imessage", (req, res) => {
  if (!secretOk(req, "x-tab-relay-secret", "IMESSAGE_RELAY_SECRET")) {
    res.status(401).json({ error: "Not allowed." });
    return;
  }
  void onMessage(req, res, true);
});

export default app;

if (!process.env.VERCEL) {
  const PORT = 3001;
  app.listen(PORT, () => {
    console.log(`Tab API running on port ${PORT}`);
  });
}
