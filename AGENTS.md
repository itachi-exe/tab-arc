# Tab

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

Tab is a USDC wallet controlled by iMessage/SMS. Users text commands ("send 20 to @jay", "split 30 with @jay and @kira") to an agent that relays signed transactions to the Tab smart contract on Arc. A daily limit caps what the agent may spend without a Face ID confirmation.

## Deployed Contracts

| Network | Address | Explorer |
|---|---|---|
| Arc Testnet (chain 5042002) | `0x8c6ba8e3de84f347df7e6be49e982d27f488b5a9` | [explorer.testnet.arc.io](https://explorer.testnet.arc.io/address/0x8c6ba8e3de84f347df7e6be49e982d27f488b5a9) |
| Arc Mainnet (chain 5042) | `0xd766C9Ed909A7EcAcfaf32c1f9DCC8Db8ed4A443` | [explorer.arc.io](https://explorer.arc.io/address/0xd766C9Ed909A7EcAcfaf32c1f9DCC8Db8ed4A443) |

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
- Chain: Arc Testnet (Chain ID: 5042002, imported from `viem/chains`)
- Token: USDC (6 decimals) (Address: 0x3600000000000000000000000000000000000000, Chain: Arc Testnet)
- Toasts: Sonner

## Key Files

- `src/App.tsx` - Main application logic
- `src/components/` - UI components
- `src/config.ts` - wagmi config (chains, connectors, transports)

## To Run

```bash
bun install
bun run dev
```
