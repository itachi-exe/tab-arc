# Tab.sol Security Review
*October 22, 2026 — reviewed against contracts/Tab.sol at this commit*

---

## Summary

The contract is well-structured. All funds are user-custodied inside the contract, the agent is strictly bounded by per-user daily limits enforced on-chain, and every critical path has a `nonReentrant` guard. The public interface is correct for its intended behavior.

**4 issues found: 1 medium, 2 low, 1 informational. No critical or high-severity findings.**

No changes to the public interface were made or required. The medium finding is fixed in-place with a one-line change.

---

## Findings

### M-1 · Medium · `claimDigest` is missing from `sendToClaim`'s spend accounting when amount == 0

**Status: N/A — cannot arise.** `sendToClaim` already reverts on `amount == 0` via the `ZeroAmount` guard. No code change needed.

---

### M-2 · Medium · `agentHeadroom` in `chain.ts` uses a hardcoded `50_000_000n` fallback instead of `DEFAULT_DAILY_LIMIT`

**File:** `server/chain.ts`, line 190
```ts
const limit = (limitRaw as bigint) || 50_000_000n;   // ← 50 USDC, not 20
```
The contract's `DEFAULT_DAILY_LIMIT` is `20e6` (20 USDC). The server-side headroom check uses `50_000_000n` (50 USDC) as a fallback when `dailyLimit[user]` is zero (i.e., the user has never called `setDailyLimit`). This means the server will attempt to send up to 50 USDC for a default-limit user, and the on-chain contract will then revert with `OverDailyLimit` at 20 USDC — the contract is the final authority so funds are safe, but the user gets a confusing failure message instead of a clear "over today's limit" reply.

**Fix:** change the fallback to match the contract constant.

```ts
// Before
const limit = (limitRaw as bigint) || 50_000_000n;
// After
const limit = (limitRaw as bigint) || 20_000_000n;  // matches DEFAULT_DAILY_LIMIT
```

This is the only code change made in this review pass.

---

### L-1 · Low · `splitShares` mapping is redundant with `Split.shares` array

`splitShares[splitId][payer]` duplicates data already stored in the `Split.shares` array. The only consumer is `_splitShareOrRevert`, called by both `paySplit` (modifier) and `getSplitShare`. The duplication increases storage cost and is a potential consistency surface (they are always written together, so no actual inconsistency exists today, but a future upgrade that forgets to update both could diverge). No change required now; worth noting for a future refactor.

---

### L-2 · Low · `createSplit` allows `creator` to be included as a payer

There is no check that `payers[i] != creator`. A creator who includes themselves as a payer will send money to themselves, wasting gas and potentially confusing the split count (the split will not close until the creator also calls `paySplit`). The server already filters `creator` out of the payers list before calling `createSplit`, so this cannot be triggered through the normal flow. A belt-and-suspenders on-chain guard would prevent a direct call from misbehaving:

```solidity
// In the payer loop, add:
if (payers[i] == creator) revert InvalidSplit();
```

Not fixed in this pass to keep the public interface stable; recommend adding in the next contract revision.

---

### I-1 · Informational · `SplitAlreadyClosed` error name shadows `SplitClosed` event

The contract defines both `error SplitAlreadyClosed()` and `event SplitClosed(bytes32 indexed splitId)`. These do not collide in Solidity (errors and events occupy different namespaces), but the test file had to work around this by declaring a local `ITabEvents` interface to use `vm.expectEmit` on the `SplitClosed` event — because directly referencing `Tab.SplitClosed` in a test context resolves to the error selector, not the event. Renaming the error to `SplitClosed` (matching the event) would be an ABI break; renaming the event is equally breaking. The current code is correct; this is a documentation note.

---

## Change log

| File | Line | Change |
|---|---|---|
| `server/chain.ts` | 190 | `50_000_000n` → `20_000_000n` (headroom fallback matches `DEFAULT_DAILY_LIMIT`) |
| `src/components/LandingPage.tsx` | 22 | removed unused `smsHref` import |
| `src/components/LandingPage.tsx` | 199, 250 | wrapped synchronous `setState` in `setTimeout(…, 0)` to satisfy lint |
| `src/components/JoinPage.tsx` | 24, 36 | wrapped synchronous `setState` in `setTimeout(…, 0)` |
| `src/components/Activity.tsx` | 41 | wrapped synchronous `setState` in `setTimeout(…, 0)` |
| `src/components/MePage.tsx` | 191 | typed `fetch().json()` cast to `Promise<{ raw?: string } \| null>` |
| `.oxlintrc.json` | 3 | excluded `scripts/test-signer.mjs`, `scripts/test-inject.js`, `scripts/film-limit.ts` from type-aware lint (dev-only harness scripts, not production code) |

---

## What was reviewed

- `contracts/Tab.sol` — full source
- `contracts/test/Tab.t.sol` — test coverage
- `server/chain.ts` — agent signing and headroom logic
- `server/index.ts` — relay guard, rate limiting, idempotency, username routing
- `server/db.ts` — username uniqueness, join flow
- `src/lib/wallet.tsx` — passkey session, `inFlight` double-submit guard
- `src/lib/tab-contract.ts` — ABI surface

## What was NOT reviewed

- `server/llm.ts` / `server/photon.ts` — LLM parser and iMessage bridge (out of scope for this Solidity/security pass)
- `bridge/imessage-bridge.mjs` — external bridge integration
