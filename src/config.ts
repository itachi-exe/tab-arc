/**
 * wagmi configuration (reads, plus the optional "use a wallet" fallback).
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, fallback, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'
import { arc, arcTestnet } from 'viem/chains'
import { ARC_CHAIN } from './lib/network'

const RPC_OVERRIDE = (import.meta.env.VITE_ARC_RPC_URL as string | undefined) || undefined

registerChain(ARC_CHAIN.id, ARC_CHAIN.rpcUrls.default.http[0])

const RELAY = typeof window !== 'undefined' ? `${window.location.origin}/api/rpc` : undefined
const active = () =>
  RPC_OVERRIDE
    ? http(RPC_OVERRIDE)
    : fallback([...(RELAY ? [http(RELAY)] : []), ...ARC_CHAIN.rpcUrls.default.http.map((u) => http(u))])

export const config = createConfig({
  // The active Arc network goes first so wallets default to it.
  chains: ARC_CHAIN.id === arc.id ? [arc, arcTestnet, mainnet] : [arcTestnet, arc, mainnet],
  connectors: [injected()],
  transports: {
    // VITE_ARC_RPC_URL overrides the active network's RPC (local forks, private RPCs).
    // Otherwise reads go through our own /api/rpc relay first (same origin, never
    // blocked by a phone's network or an extension), public RPCs as backup.
    [arc.id]: ARC_CHAIN.id === arc.id ? active() : http(),
    [arcTestnet.id]: ARC_CHAIN.id === arcTestnet.id ? active() : http(),
    [mainnet.id]: http(), // ENS resolution
  },
})
