/**
 * Which Arc network the app talks to. One switch: VITE_ARC_NETWORK=arc | arcTestnet.
 * Defaults to Arc mainnet, matching the server.
 */
import { arc, arcTestnet } from "viem/chains";

export const ARC_NETWORK: "arc" | "arcTestnet" =
  import.meta.env.VITE_ARC_NETWORK === "arcTestnet" ? "arcTestnet" : "arc";

export const IS_TESTNET = ARC_NETWORK === "arcTestnet";

export const ARC_CHAIN = ARC_NETWORK === "arcTestnet" ? arcTestnet : arc;
export const ARC_CHAIN_ID = ARC_CHAIN.id;
export const ARC_EXPLORER = ARC_CHAIN.blockExplorers.default.url;

/** Native USDC on Arc, same address on mainnet and testnet. */
export const ARC_USDC = "0x3600000000000000000000000000000000000000" as const;
