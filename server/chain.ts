/**
 * On-chain interactions for the Tab contract.
 * The AGENT private key lives only here — never on-chain or in the frontend.
 *
 * RPC is resolved from the Arc Studio RPC proxy (RPC_PROXY_* env vars).
 * USDC address comes from @/onchain-facts (chain ID 5042 = Arc mainnet).
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arc, arcTestnet } from "viem/chains";

// One switch, same as the frontend: ARC_NETWORK (or VITE_ARC_NETWORK) = arc | arcTestnet.
const NETWORK = (process.env.ARC_NETWORK ?? process.env.VITE_ARC_NETWORK) === "arcTestnet" ? "arcTestnet" : "arc";
const CHAIN = NETWORK === "arcTestnet" ? arcTestnet : arc;
const ARC_CHAIN_ID = CHAIN.id;
// Arc USDC ERC-20 — same address on testnet and mainnet (canonical predeploy)
// arc-studio-allow-onchain-literal
const ARC_USDC = "0x3600000000000000000000000000000000000000" as Hex;

// Loaded from env — never hardcoded
const TAB_ADDRESS = (process.env.VITE_TAB_ADDRESS ?? "") as Hex;
const AGENT_PRIVATE_KEY = (process.env.AGENT_PRIVATE_KEY ?? "") as Hex;

export const ARC_EXPLORER = CHAIN.blockExplorers.default.url;

// Resolve RPC URL from Arc Studio RPC proxy; fall back to public endpoint.
function resolveRpcUrl(): string {
  if (process.env.ARC_RPC_URL) return process.env.ARC_RPC_URL;
  const proxyBase = process.env.RPC_PROXY_BASE_URL;
  const proxyToken = process.env.RPC_PROXY_TOKEN;
  const proxyChains = (process.env.RPC_PROXY_CHAINS ?? "").split(",");
  const compassChain = NETWORK === "arcTestnet" ? "ArcTestnet" : "Arc";

  if (proxyBase && proxyToken && proxyChains.includes(compassChain)) {
    return `${proxyBase}/api/rpc/${compassChain}?_rpc_token=${proxyToken}`;
  }

  // Public fallback — may rate-limit under heavy load
  // arc-studio-allow-onchain-literal
  return CHAIN.rpcUrls.default.http[0];
}

export const tabAbi = parseAbi([
  "function deposit(uint256 amount)",
  "function withdraw(uint256 amount)",
  "function send(address from, address to, uint256 amount)",
  "function sendToClaim(address from, bytes32 claimId, uint256 amount, address claimKey)",
  "function claim(bytes32 claimId, address recipient, bytes signature)",
  "function lastSpendDay(address) view returns (uint256)",
  "function agentDisabled(address) view returns (bool)",
  "function agentPaused() view returns (bool)",
  "function refundClaim(bytes32 claimId)",
  "function createSplit(bytes32 splitId, address creator, address[] calldata payers, uint256[] calldata shares)",
  "function paySplit(bytes32 splitId, address payer)",
  "function hold(bytes32 holdId, address from, address to, uint256 amount, uint256 deadline)",
  "function release(bytes32 holdId)",
  "function refundHold(bytes32 holdId)",
  "function holds(bytes32) view returns (address payer, address payee, uint256 amount, uint256 deadline, bool released, bool refunded)",
  "function balances(address) view returns (uint256)",
  "function dailyLimit(address) view returns (uint256)",
  "function spentToday(address) view returns (uint256)",
  "function getSplitMeta(bytes32 splitId) view returns (address creator, uint256 payerCount, uint256 paidCount, bool closed)",
  "function getSplitShare(bytes32 splitId, address payer) view returns (uint256)",
  "function isSplitPayerPaid(bytes32 splitId, address payer) view returns (bool)",
  "error OverDailyLimit()",
  "error Unauthorized()",
  "error ClaimAlreadyUsed()",
  "error HoldAlreadyUsed()",
  "error HoldNotExpired()",
  "error InvalidSplit()",
  "error AlreadyPaid()",
  "error SplitAlreadyClosed()",
  "error InsufficientBalance()",
  "error ZeroAmount()",
  "error AgentBlocked()",
  "error BadRecipient()",
  "error BadDeadline()",
  "event Sent(address indexed from, address indexed to, uint256 amount)",
  "event ClaimCreated(bytes32 indexed claimId, address indexed from, uint256 amount)",
  "event SplitCreated(bytes32 indexed splitId, address indexed creator, address[] payers, uint256[] shares)",
  "event HoldCreated(bytes32 indexed holdId, address indexed from, address indexed to, uint256 amount, uint256 deadline)",
]);

function getPublicClient() {
  const rpcUrl = resolveRpcUrl();
  return createPublicClient({
    chain: CHAIN,
    transport: http(rpcUrl),
  });
}

function getAgentClient() {
  if (!AGENT_PRIVATE_KEY || AGENT_PRIVATE_KEY.length < 10) {
    throw new Error("AGENT_PRIVATE_KEY not configured");
  }
  const rpcUrl = resolveRpcUrl();
  const account = privateKeyToAccount(AGENT_PRIVATE_KEY);
  return {
    client: createWalletClient({
      account,
      chain: CHAIN,
      transport: http(rpcUrl),
    }),
    account,
  };
}

export async function getBalance(address: string): Promise<bigint> {
  const client = getPublicClient();
  return client.readContract({
    address: TAB_ADDRESS,
    abi: tabAbi,
    functionName: "balances",
    args: [address as Hex],
  }) as Promise<bigint>;
}

/** USDC sitting in the user's own wallet (not yet in Tab). */
export async function walletUsdc(address: Hex): Promise<bigint> {
  return getPublicClient().readContract({
    address: ARC_USDC as Hex,
    abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
    functionName: "balanceOf",
    args: [address],
  }) as Promise<bigint>;
}

/**
 * Every agent write goes through here: simulate first (a revert never costs
 * gas or leaves a half-done state), then send, then wait for the receipt.
 * Callers only ever report success after the chain confirms it.
 */
async function agentWrite(functionName: string, args: readonly unknown[]): Promise<string> {
  if (!TAB_ADDRESS) throw new Error("TAB_NOT_DEPLOYED");
  const { client, account } = getAgentClient();
  const pub = getPublicClient();
  const { request } = await pub.simulateContract({
    account,
    address: TAB_ADDRESS,
    abi: tabAbi,
    functionName: functionName as never,
    args: args as never,
  });
  const hash = await client.writeContract(request as never);
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 30_000 });
  if (receipt.status !== "success") throw new Error("TX_REVERTED");
  return hash;
}

export const sendFunds = (from: string, to: string, amount: bigint) =>
  agentWrite("send", [from as Hex, to as Hex, amount]);

/** Locks funds for someone without a wallet. Only the link key can claim them. */
export const sendToClaim = (from: string, claimId: Hex, amount: bigint, claimKey: Hex) =>
  agentWrite("sendToClaim", [from as Hex, claimId, amount, claimKey]);

export const createSplit = (splitId: Hex, creator: string, payers: string[], shares: bigint[]) =>
  agentWrite("createSplit", [splitId, creator as Hex, payers as Hex[], shares]);

export const paySplit = (splitId: Hex, payer: string) =>
  agentWrite("paySplit", [splitId, payer as Hex]);

export const createHold = (holdId: Hex, from: string, to: string, amount: bigint, deadline: bigint) =>
  agentWrite("hold", [holdId, from as Hex, to as Hex, amount, deadline]);

export const releaseHold = (holdId: Hex) => agentWrite("release", [holdId]);

/** Who set up a hold. Only that person may release it by text. */
export async function holdPayer(holdId: Hex): Promise<string> {
  const h = (await getPublicClient().readContract({ address: TAB_ADDRESS, abi: tabAbi, functionName: "holds", args: [holdId] })) as readonly unknown[];
  return String(h[0]);
}

/** How much more the agent may move for this user today, read from the contract. */
export async function agentHeadroom(user: string): Promise<{ left: bigint; disabled: boolean }> {
  const pub = getPublicClient();
  const read = (functionName: string, args: unknown[]) =>
    pub.readContract({ address: TAB_ADDRESS, abi: tabAbi, functionName: functionName as never, args: args as never }) as Promise<unknown>;
  const [limitRaw, spent, lastDay, disabled, paused] = await Promise.all([
    read("dailyLimit", [user]), read("spentToday", [user]), read("lastSpendDay", [user]),
    read("agentDisabled", [user]), read("agentPaused", []),
  ]);
  const limit = (limitRaw as bigint) || 20_000_000n; // matches DEFAULT_DAILY_LIMIT
  const today = BigInt(Math.floor(Date.now() / 86_400_000));
  const used = (lastDay as bigint) < today ? 0n : (spent as bigint);
  return { left: limit > used ? limit - used : 0n, disabled: Boolean(disabled) || Boolean(paused) };
}

/** True when the wallet really signed it. Handles smart accounts (ERC-1271 / 6492) too. */
export async function verifySigned(address: string, message: string, signature: Hex): Promise<boolean> {
  try {
    return await getPublicClient().verifyMessage({ address: address as Hex, message, signature });
  } catch {
    return false;
  }
}

export function shortExplorerLink(txHash: string): string {
  return `${ARC_EXPLORER}/tx/${txHash}`;
}

export { ARC_USDC, TAB_ADDRESS, ARC_CHAIN_ID };
