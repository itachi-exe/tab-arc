/**
 * Tab contract config for the frontend.
 * Address is read from env; ABI from the Foundry artifact.
 */
import { encodeFunctionData, parseAbi } from "viem";
import { ARC_CHAIN_ID, ARC_EXPLORER } from "./network";

/** encodeFunctionData with a runtime function name (the ABI still validates it). */
const encodeLoose = encodeFunctionData as unknown as (p: { abi: unknown; functionName: string; args: readonly unknown[] }) => `0x${string}`;
export { ARC_EXPLORER };

export const TAB_ADDRESS = (import.meta.env.VITE_TAB_ADDRESS ?? "") as `0x${string}`;

/** The chain the app runs on (see network.ts). Kept under the old name for existing imports. */
export const ARC_MAINNET_CHAIN_ID = ARC_CHAIN_ID;

export const tabAbi = parseAbi([
  "function deposit(uint256 amount)",
  "function withdraw(uint256 amount)",
  "function send(address from, address to, uint256 amount)",
  "function sendToClaim(address from, bytes32 claimId, uint256 amount, address claimKey)",
  "function claim(bytes32 claimId, address recipient, bytes signature)",
  "function claimDigest(bytes32 claimId, address recipient) view returns (bytes32)",
  "function setAgentDisabled(bool disabled)",
  "function agentDisabled(address) view returns (bool)",
  "function refundClaim(bytes32 claimId)",
  "function createSplit(bytes32 splitId, address creator, address[] calldata payers, uint256[] calldata shares)",
  "function paySplit(bytes32 splitId, address payer)",
  "function hold(bytes32 holdId, address from, address to, uint256 amount, uint256 deadline)",
  "function release(bytes32 holdId)",
  "function refundHold(bytes32 holdId)",
  "function balances(address) view returns (uint256)",
  "function dailyLimit(address) view returns (uint256)",
  "function spentToday(address) view returns (uint256)",
  "function getSplitMeta(bytes32 splitId) view returns (address creator, uint256 payerCount, uint256 paidCount, bool closed)",
  "function getSplitShare(bytes32 splitId, address payer) view returns (uint256)",
  "function isSplitPayerPaid(bytes32 splitId, address payer) view returns (bool)",
  "function holds(bytes32) view returns (address payer, address payee, uint256 amount, uint256 deadline, bool released, bool refunded)",
  "function claims(bytes32) view returns (address sender, address claimKey, uint256 amount, bool claimed, bool refunded, uint256 createdAt)",
]);

export function explorerTx(hash: string): string {
  return `${ARC_EXPLORER}/tx/${hash}`;
}

export function shortHash(hash: string): string {
  return hash.slice(0, 8) + "…" + hash.slice(-6);
}

/** Encode a Tab call for useTabWallet().send(). */
export function tabCall(functionName: string, args: readonly unknown[]): { to: `0x${string}`; data: `0x${string}` } {
  return {
    to: TAB_ADDRESS,
    data: encodeLoose({ abi: tabAbi, functionName, args }),
  };
}
