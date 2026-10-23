/**
 * Off-chain handle <-> wallet mapping.
 * In production this would be Postgres. For the demo we use a JSON file
 * so the repo is self-contained.  Phone numbers are stored only here —
 * they never touch the chain, not even hashed.
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync } from "fs";
import { join } from "path";

export interface Contact {
  handle: string; // the phone number that texts Tab, e.g. "+14155550100"
  address: string; // 0x… wallet address on Arc
  username: string; // unique, lowercase, how people pay you: "bob"
}

/** 3 to 20 characters: starts with a letter, then letters, digits or _. */
export const USERNAME_RE = /^[a-z][a-z0-9_]{2,19}$/;
const RESERVED = new Set(["tab", "admin", "support", "help", "balance", "send", "split", "hold", "release", "join", "me", "you", "deposit", "withdraw"]);
export const cleanUsername = (u: string) => String(u ?? "").trim().replace(/^@/, "").toLowerCase();
export const usernameOk = (u: string) => USERNAME_RE.test(u) && !RESERVED.has(u);

export interface PendingAction {
  id: string;
  type: "send" | "split" | "hold" | "release";
  fromHandle: string;
  data: Record<string, unknown>;
  createdAt: number;
}

export interface PendingJoin {
  code: string;
  address: string;
  username: string;
  phone: string;
  createdAt: number;
}

interface DB {
  contacts: Contact[];
  pendingActions: PendingAction[];
  joins?: PendingJoin[];
}

const JOIN_TTL_MS = 30 * 60_000;

const SEED_PATH = join(process.cwd(), "server", "db.json");
// Vercel's filesystem is read-only except /tmp. State there lasts only as long as the warm instance.
const DB_PATH = process.env.TAB_DB_PATH ?? (process.env.VERCEL ? "/tmp/tab-db.json" : SEED_PATH);
if (process.env.VERCEL && !existsSync(DB_PATH) && existsSync(SEED_PATH)) {
  copyFileSync(SEED_PATH, DB_PATH);
}

// Contacts can also ship in env (TAB_CONTACTS, a JSON array), so a cold
// serverless instance never forgets who is who.
// Older rows carried a display "name". Usernames replace it.
function normalize(c: Contact & { name?: string }): Contact | null {
  if (!c || !c.handle || !c.address) return null;
  const username = cleanUsername(c.username ?? c.name ?? "");
  return username ? { handle: c.handle, address: c.address, username } : null;
}

function envContacts(): Contact[] {
  try {
    const v = JSON.parse(process.env.TAB_CONTACTS ?? "[]") as Contact[];
    return Array.isArray(v) ? (v.map(normalize).filter(Boolean) as Contact[]) : [];
  } catch {
    return [];
  }
}

function readDb(): DB {
  const db: DB = existsSync(DB_PATH)
    ? (JSON.parse(readFileSync(DB_PATH, "utf-8")) as DB)
    : { contacts: [], pendingActions: [] };
  db.contacts = db.contacts.map(normalize).filter(Boolean) as Contact[];
  for (const c of envContacts()) {
    if (!db.contacts.some((x) => x.handle.toLowerCase() === c.handle.toLowerCase())) db.contacts.push(c);
  }
  return db;
}

function writeDb(db: DB): void {
  writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

/** The phone number a text came from. Exact match only. */
export function findByHandle(handle: string): Contact | undefined {
  const h = handle.toLowerCase().trim();
  return readDb().contacts.find((c) => c.handle.toLowerCase() === h);
}

/** Usernames are unique, so this is one person or nobody. Never fuzzy. */
export function findByUsername(query: string): Contact | undefined {
  const u = cleanUsername(query);
  return readDb().contacts.find((c) => c.username === u);
}

/** Closest existing username within 2 edits, for "did you mean". Never auto-used. */
export function nearestUsername(query: string): string | undefined {
  const q = cleanUsername(query);
  const dist = (a: string, b: string) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++)
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  };
  let best: { u: string; d: number } | undefined;
  for (const c of readDb().contacts) {
    if (!c.username) continue;
    const d = dist(q, c.username);
    if (d <= 2 && (!best || d < best.d)) best = { u: c.username, d };
  }
  return best?.u;
}

/** The username a wallet already owns, if any. */
export function usernameOf(address: string): string | undefined {
  const a = address.toLowerCase();
  return readDb().contacts.find((c) => c.address.toLowerCase() === a)?.username;
}

/** Taken if another wallet owns it, or has an open join code for it. */
export function usernameTaken(username: string, address: string): boolean {
  const db = readDb();
  const a = address.toLowerCase();
  const now = Date.now();
  return (
    db.contacts.some((c) => c.username === username && c.address.toLowerCase() !== a) ||
    (db.joins ?? []).some((j) => j.username === username && j.address.toLowerCase() !== a && now - j.createdAt < JOIN_TTL_MS)
  );
}

export function getContacts(): Contact[] {
  return readDb().contacts;
}

export function upsertContact(contact: Contact): void {
  const db = readDb();
  const idx = db.contacts.findIndex((c) => c.handle === contact.handle);
  if (idx >= 0) {
    db.contacts[idx] = contact;
  } else {
    db.contacts.push(contact);
  }
  writeDb(db);
}


/** One open code per wallet. A new request replaces the old one. */
export function storeJoin(join: PendingJoin): void {
  const db = readDb();
  const now = Date.now();
  db.joins = (db.joins ?? []).filter((j) => now - j.createdAt < JOIN_TTL_MS && j.address.toLowerCase() !== join.address.toLowerCase());
  db.joins.push(join);
  writeDb(db);
}

/** Single use: the code is gone once it has been texted in. */
export function takeJoin(code: string): PendingJoin | undefined {
  const db = readDb();
  const now = Date.now();
  const hit = (db.joins ?? []).find((j) => j.code === code.toUpperCase() && now - j.createdAt < JOIN_TTL_MS);
  db.joins = (db.joins ?? []).filter((j) => j !== hit && now - j.createdAt < JOIN_TTL_MS);
  writeDb(db);
  return hit;
}

export function storePendingAction(action: PendingAction): void {
  const db = readDb();
  db.pendingActions.push(action);
  writeDb(db);
}

export function getPendingAction(id: string): PendingAction | undefined {
  return readDb().pendingActions.find((a) => a.id === id);
}

export function removePendingAction(id: string): void {
  const db = readDb();
  db.pendingActions = db.pendingActions.filter((a) => a.id !== id);
  writeDb(db);
}
