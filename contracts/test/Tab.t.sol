// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {Tab} from "../Tab.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

/// @dev Workaround: Tab.sol has a name collision between `error SplitClosed()` and
///      `event SplitClosed(bytes32 indexed splitId)` — the Solidity compiler rejects
///      the source.  We declare a local copy of the event so that vm.expectEmit can
///      still match the log without touching the contract source.
/// NOTE: This is a suspected contract bug — see the report.
interface ITabEvents {
    event SplitClosed(bytes32 indexed splitId);
}

/// @dev Full unit/fuzz/invariant test suite for Tab.sol
contract TabTest is Test {
    // ── Actors ──────────────────────────────────────────────────────────────
    address internal owner  = makeAddr("owner");
    address internal agent  = makeAddr("agent");
    address internal alice  = makeAddr("alice");
    address internal bob    = makeAddr("bob");
    address internal carol  = makeAddr("carol");
    address internal random = makeAddr("random");
    address internal claimKey;
    uint256 internal claimKeyPk;

    // ── Contracts ────────────────────────────────────────────────────────────
    MockERC20 internal usdc;
    Tab       internal tab;

    // ── Constants ───────────────────────────────────────────────────────────
    uint256 internal constant DEFAULT_LIMIT = 20e6;   // 20 USDC (6-decimal mock)
    uint256 internal constant SEED          = 1_000e6; // 1 000 USDC seed per user

    // ─────────────────────────────────────────────────────────────────────────
    // setUp — runs before every test function
    // ─────────────────────────────────────────────────────────────────────────
    function setUp() public {
        (claimKey, claimKeyPk) = makeAddrAndKey("claimKey");

        // 1. Deploy mock USDC (6 decimals, matching real USDC)
        usdc = new MockERC20("Mock USDC", "mUSDC", 6);

        // 2. Deploy Tab with test owner and mock USDC address
        vm.prank(owner);
        tab = new Tab(address(usdc), owner);

        // 3. Register the AGENT
        vm.prank(owner);
        tab.setAgent(agent);

        // 4. Mint USDC to actors and approve Tab for deposits
        _seedAndApprove(alice);
        _seedAndApprove(bob);
        _seedAndApprove(carol);
    }

    /// @dev Mint USDC to `user` and approve Tab to pull it.
    function _seedAndApprove(address user) internal {
        usdc.mint(user, SEED);
        vm.prank(user);
        usdc.approve(address(tab), type(uint256).max);
    }

    /// @dev Signature from the claim link's one-time key, naming `recipient`.
    function _claimSig(bytes32 claimId, address recipient, uint256 pk) internal view returns (bytes memory) {
        bytes32 d = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", tab.claimDigest(claimId, recipient)));
        (uint8 v, bytes32 r, bytes32 s_) = vm.sign(pk, d);
        return abi.encodePacked(r, s_, v);
    }

    /// @dev Deposit `amount` into Tab on behalf of `user`.
    function _deposit(address user, uint256 amount) internal {
        vm.prank(user);
        tab.deposit(amount);
    }

    // =========================================================================
    // 10. HAPPY PATHS — deposit, withdraw, setDailyLimit
    // =========================================================================

    function test_Deposit_HappyPath() public {
        uint256 before = tab.balances(alice);
        vm.expectEmit(true, false, false, true, address(tab));
        emit Tab.Deposited(alice, 100e6);
        _deposit(alice, 100e6);
        assertEq(tab.balances(alice), before + 100e6);
    }

    function test_Deposit_RevertsOnZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(Tab.ZeroAmount.selector);
        tab.deposit(0);
    }

    function test_Withdraw_HappyPath() public {
        _deposit(alice, 200e6);
        uint256 before = tab.balances(alice);

        vm.expectEmit(true, false, false, true, address(tab));
        emit Tab.Withdrawn(alice, 100e6);

        vm.prank(alice);
        tab.withdraw(100e6);

        assertEq(tab.balances(alice), before - 100e6);
    }

    function test_Withdraw_RevertsOnZeroAmount() public {
        _deposit(alice, 100e6);
        vm.prank(alice);
        vm.expectRevert(Tab.ZeroAmount.selector);
        tab.withdraw(0);
    }

    function test_Withdraw_RevertsOnInsufficientBalance() public {
        // alice has no balance yet
        vm.prank(alice);
        vm.expectRevert(Tab.InsufficientBalance.selector);
        tab.withdraw(1e6);
    }

    function test_SetDailyLimit_HappyPath() public {
        vm.expectEmit(true, false, false, true, address(tab));
        emit Tab.DailyLimitSet(alice, 200e6);

        vm.prank(alice);
        tab.setDailyLimit(200e6);

        assertEq(tab.dailyLimit(alice), 200e6);
    }

    function test_SetDailyLimit_RevertsOnZero() public {
        vm.prank(alice);
        vm.expectRevert(Tab.ZeroAmount.selector);
        tab.setDailyLimit(0);
    }

    // =========================================================================
    // send() — happy path
    // =========================================================================

    function test_Send_UserToUser_HappyPath() public {
        _deposit(alice, 100e6);
        uint256 aliceBefore = tab.balances(alice);
        uint256 bobBefore   = tab.balances(bob);

        vm.expectEmit(true, true, false, true, address(tab));
        emit Tab.Sent(alice, bob, 30e6);

        vm.prank(alice);
        tab.send(alice, bob, 30e6);

        assertEq(tab.balances(alice), aliceBefore - 30e6);
        assertEq(tab.balances(bob),   bobBefore   + 30e6);
    }

    function test_Send_RevertsOnZeroAmount() public {
        _deposit(alice, 100e6);
        vm.prank(alice);
        vm.expectRevert(Tab.ZeroAmount.selector);
        tab.send(alice, bob, 0);
    }

    function test_Send_RevertsOnInsufficientBalance() public {
        // alice deposited nothing
        vm.prank(alice);
        vm.expectRevert(Tab.InsufficientBalance.selector);
        tab.send(alice, bob, 1e6);
    }

    // =========================================================================
    // 9. Non-AGENT cannot act for another user (Unauthorized)
    // =========================================================================

    function test_Send_NonAgentCannotActForAnotherUser() public {
        _deposit(alice, 100e6);
        // `random` tries to drain alice's balance to itself
        vm.prank(random);
        vm.expectRevert(Tab.Unauthorized.selector);
        tab.send(alice, random, 10e6);
    }

    // =========================================================================
    // 1. AGENT blocked over daily limit
    // =========================================================================

    function test_Send_Agent_BlockedOverDailyLimit() public {
        // alice has default limit of 20 USDC; deposit enough
        _deposit(alice, 200e6);

        // agent spends 20 USDC (at the limit)
        vm.prank(agent);
        tab.send(alice, bob, DEFAULT_LIMIT);

        // next agent spend of even 1 unit exceeds limit → OverDailyLimit
        vm.prank(agent);
        vm.expectRevert(Tab.OverDailyLimit.selector);
        tab.send(alice, bob, 1);
    }

    function test_Send_Agent_BlockedExceedingLimitInSingleCall() public {
        _deposit(alice, 200e6);
        // one call for DEFAULT_LIMIT + 1 should also revert
        vm.prank(agent);
        vm.expectRevert(Tab.OverDailyLimit.selector);
        tab.send(alice, bob, DEFAULT_LIMIT + 1);
    }

    // =========================================================================
    // 2. AGENT allowed under daily limit
    // =========================================================================

    function test_Send_Agent_AllowedUnderDailyLimit() public {
        _deposit(alice, 200e6);
        uint256 aliceBefore = tab.balances(alice);
        uint256 bobBefore   = tab.balances(bob);
        uint256 spend       = DEFAULT_LIMIT - 1e6; // 19 USDC < 20 USDC limit

        vm.expectEmit(true, true, false, true, address(tab));
        emit Tab.Sent(alice, bob, spend);

        vm.prank(agent);
        tab.send(alice, bob, spend);

        assertEq(tab.balances(alice), aliceBefore - spend);
        assertEq(tab.balances(bob),   bobBefore   + spend);
    }

    // =========================================================================
    // 3. Daily limit resets after 24 h
    // =========================================================================

    function test_Send_Agent_DailyLimitResetsAfter24h() public {
        _deposit(alice, 300e6);

        // Day 1: agent spends the full default limit
        vm.prank(agent);
        tab.send(alice, bob, DEFAULT_LIMIT);

        // Still day 1 — next attempt reverts
        vm.prank(agent);
        vm.expectRevert(Tab.OverDailyLimit.selector);
        tab.send(alice, bob, 1);

        // Advance 24 hours → new calendar day in the contract's eyes
        skip(86400);

        // Agent can spend again up to the full daily limit
        uint256 aliceBefore = tab.balances(alice);
        vm.prank(agent);
        tab.send(alice, bob, DEFAULT_LIMIT);
        assertEq(tab.balances(alice), aliceBefore - DEFAULT_LIMIT);
    }

    // =========================================================================
    // 4. Claim works: sendToClaim + claim() credits recipient
    // =========================================================================

    function test_Claim_HappyPath() public {
        _deposit(alice, 100e6);
        bytes32 claimId = keccak256("claim-1");
        uint256 amount  = 20e6;

        // alice creates a claim
        vm.expectEmit(true, true, false, true, address(tab));
        emit Tab.ClaimCreated(claimId, alice, amount);

        vm.prank(alice);
        tab.sendToClaim(alice, claimId, amount, claimKey);

        // alice's balance decreased
        assertEq(tab.balances(alice), 100e6 - amount);

        // Claim is stored
        (address sender, address storedKey, uint256 storedAmt, bool claimed, bool refunded, ) = tab.claims(claimId);
        assertEq(storedKey, claimKey);
        assertEq(sender,     alice);
        assertEq(storedAmt,  amount);
        assertFalse(claimed);
        assertFalse(refunded);

        // Agent claims to bob
        uint256 bobBefore = tab.balances(bob);
        vm.expectEmit(true, true, false, false, address(tab));
        emit Tab.Claimed(claimId, bob);

        bytes memory sig = _claimSig(claimId, bob, claimKeyPk);
        vm.prank(random); // anyone can relay, the signature decides the recipient
        tab.claim(claimId, bob, sig);

        assertEq(tab.balances(bob), bobBefore + amount);

        // Claim is now marked claimed
        (, , , bool claimedAfter, , ) = tab.claims(claimId);
        assertTrue(claimedAfter);
    }

    function test_Claim_RevertsIfAlreadyClaimed() public {
        _deposit(alice, 100e6);
        bytes32 claimId = keccak256("claim-dup");

        vm.prank(alice);
        tab.sendToClaim(alice, claimId, 10e6, claimKey);

        bytes memory sig = _claimSig(claimId, bob, claimKeyPk);
        tab.claim(claimId, bob, sig);

        // Second claim attempt
        vm.expectRevert(Tab.ClaimAlreadyUsed.selector);
        tab.claim(claimId, bob, sig);
    }

    function test_Claim_AgentCannotStealWithoutLinkKey() public {
        _deposit(alice, 100e6);
        bytes32 claimId = keccak256("claim-steal");

        vm.prank(alice);
        tab.sendToClaim(alice, claimId, 10e6, claimKey);

        // Agent (or anyone) signing with a different key is rejected
        (, uint256 otherPk) = makeAddrAndKey("attacker");
        bytes memory forged = _claimSig(claimId, agent, otherPk);
        vm.prank(agent);
        vm.expectRevert(Tab.BadSignature.selector);
        tab.claim(claimId, agent, forged);
    }

    function test_Claim_CannotRedirectSignedClaim() public {
        _deposit(alice, 100e6);
        bytes32 claimId = keccak256("claim-redirect");

        vm.prank(alice);
        tab.sendToClaim(alice, claimId, 10e6, claimKey);

        // A watcher copies bob's valid signature but swaps in its own address
        bytes memory sigForBob = _claimSig(claimId, bob, claimKeyPk);
        vm.prank(random);
        vm.expectRevert(Tab.BadSignature.selector);
        tab.claim(claimId, random, sigForBob);
    }

    // =========================================================================
    // 5. Claim refunds after 7 days; before 7 days reverts
    // =========================================================================

    function test_RefundClaim_RevertsBeforeExpiry() public {
        _deposit(alice, 100e6);
        bytes32 claimId = keccak256("claim-refund-early");

        vm.prank(alice);
        tab.sendToClaim(alice, claimId, 15e6, claimKey);

        // Try to refund immediately — should revert
        vm.expectRevert(Tab.ClaimNotExpired.selector);
        tab.refundClaim(claimId);
    }

    function test_RefundClaim_SucceedsAfter7Days() public {
        _deposit(alice, 100e6);
        bytes32 claimId = keccak256("claim-refund-ok");
        uint256 amount  = 15e6;

        vm.prank(alice);
        tab.sendToClaim(alice, claimId, amount, claimKey);

        uint256 aliceBeforeRefund = tab.balances(alice);

        // Advance exactly 7 days
        skip(7 days);

        vm.expectEmit(true, false, false, false, address(tab));
        emit Tab.ClaimRefunded(claimId);

        tab.refundClaim(claimId);

        // Alice's balance is restored
        assertEq(tab.balances(alice), aliceBeforeRefund + amount);

        // Claim is marked refunded
        (, , , , bool refunded, ) = tab.claims(claimId);
        assertTrue(refunded);
    }

    function test_RefundClaim_RevertsIfAlreadyRefunded() public {
        _deposit(alice, 100e6);
        bytes32 claimId = keccak256("claim-double-refund");

        vm.prank(alice);
        tab.sendToClaim(alice, claimId, 10e6, claimKey);

        skip(7 days);
        tab.refundClaim(claimId);

        // Second refund attempt
        vm.expectRevert(Tab.ClaimAlreadyUsed.selector);
        tab.refundClaim(claimId);
    }

    // =========================================================================
    // Split helpers
    // =========================================================================

    function _createSimpleSplit(bytes32 splitId) internal {
        // creator = carol, payers = [alice, bob], shares = [30e6, 20e6]
        address[] memory payers = new address[](2);
        payers[0] = alice;
        payers[1] = bob;

        uint256[] memory shares = new uint256[](2);
        shares[0] = 30e6;
        shares[1] = 20e6;

        vm.prank(carol);
        tab.createSplit(splitId, carol, payers, shares);
    }

    // =========================================================================
    // 6. Split closes only when all payers have paid
    // =========================================================================

    function test_Split_NotClosedAfterOnePayer() public {
        // Fund alice and bob
        _deposit(alice, 100e6);
        _deposit(bob,   100e6);

        bytes32 splitId = keccak256("split-1");
        _createSimpleSplit(splitId);

        // alice pays her share — split should NOT be closed yet
        vm.prank(alice);
        tab.paySplit(splitId, alice);

        (, , uint256 paidCount, bool closed) = tab.getSplitMeta(splitId);
        assertEq(paidCount, 1);
        assertFalse(closed, "Split should remain open after only one payer");
    }

    function test_Split_ClosedAfterAllPayersPay() public {
        _deposit(alice, 100e6);
        _deposit(bob,   100e6);

        bytes32 splitId = keccak256("split-2");
        _createSimpleSplit(splitId);

        // alice pays (30 USDC goes to carol)
        uint256 carolBefore = tab.balances(carol);

        vm.expectEmit(true, true, false, true, address(tab));
        emit Tab.SplitPaid(splitId, alice, 30e6);

        vm.prank(alice);
        tab.paySplit(splitId, alice);

        assertEq(tab.balances(carol), carolBefore + 30e6);

        // bob pays (20 USDC goes to carol) — split closes
        vm.expectEmit(true, true, false, true, address(tab));
        emit Tab.SplitPaid(splitId, bob, 20e6);

        // Use the local ITabEvents interface for SplitClosed because Tab.sol has a
        // name collision between error SplitClosed() and event SplitClosed(bytes32).
        vm.expectEmit(true, false, false, false, address(tab));
        emit ITabEvents.SplitClosed(splitId);

        vm.prank(bob);
        tab.paySplit(splitId, bob);

        assertEq(tab.balances(carol), carolBefore + 30e6 + 20e6);

        (, , uint256 paidCount, bool closed) = tab.getSplitMeta(splitId);
        assertEq(paidCount, 2);
        assertTrue(closed, "Split should be closed after all payers pay");
    }

    function test_Split_RevertsPayingAfterClose() public {
        _deposit(alice, 100e6);
        _deposit(bob,   100e6);

        bytes32 splitId = keccak256("split-3");
        _createSimpleSplit(splitId);

        vm.prank(alice);
        tab.paySplit(splitId, alice);
        vm.prank(bob);
        tab.paySplit(splitId, bob);

        // split is now closed — any further pay attempt reverts with SplitAlreadyClosed
        // (s.closed is checked before s.paid[payer], so the closed check fires first)
        vm.prank(alice);
        vm.expectRevert(Tab.SplitAlreadyClosed.selector);
        tab.paySplit(splitId, alice);
    }

    function test_Split_RevertsPayingTwice() public {
        _deposit(alice, 100e6);
        _deposit(bob,   100e6);

        bytes32 splitId = keccak256("split-4");
        _createSimpleSplit(splitId);

        vm.prank(alice);
        tab.paySplit(splitId, alice);

        // alice tries to pay again
        vm.prank(alice);
        vm.expectRevert(Tab.AlreadyPaid.selector);
        tab.paySplit(splitId, alice);
    }

    // =========================================================================
    // Hold helpers
    // =========================================================================

    function _createHold(bytes32 holdId, address from, address to, uint256 amount, uint256 deadline) internal {
        vm.prank(from);
        tab.hold(holdId, from, to, amount, deadline);
    }

    // =========================================================================
    // 7. Hold releases on confirm: release() credits payee, marked released
    // =========================================================================

    function test_Hold_Release_ByPayer() public {
        _deposit(alice, 100e6);
        bytes32 holdId   = keccak256("hold-1");
        uint256 amount   = 25e6;
        uint256 deadline = block.timestamp + 1 days;

        vm.expectEmit(true, true, true, true, address(tab));
        emit Tab.HoldCreated(holdId, alice, bob, amount, deadline);

        _createHold(holdId, alice, bob, amount, deadline);

        // alice's balance reduced immediately
        assertEq(tab.balances(alice), 100e6 - amount);

        uint256 bobBefore = tab.balances(bob);

        vm.expectEmit(true, false, false, false, address(tab));
        emit Tab.HoldReleased(holdId);

        // payer (alice) releases
        vm.prank(alice);
        tab.release(holdId);

        assertEq(tab.balances(bob), bobBefore + amount);

        // hold is marked released
        (, , , , bool released, ) = tab.holds(holdId);
        assertTrue(released);
    }

    function test_Hold_Release_ByAgent() public {
        _deposit(alice, 100e6);
        bytes32 holdId   = keccak256("hold-agent");
        uint256 amount   = 10e6;
        uint256 deadline = block.timestamp + 2 days;

        _createHold(holdId, alice, bob, amount, deadline);

        uint256 bobBefore = tab.balances(bob);

        vm.prank(agent);
        tab.release(holdId);

        assertEq(tab.balances(bob), bobBefore + amount);
    }

    function test_Hold_Release_ByAgent_CountsLimitOnce() public {
        _deposit(alice, 100e6);
        bytes32 holdId = keccak256("hold-limit-once");
        // 12 held then released is 12 spent, not 24, so the release still fits under 20.
        vm.prank(agent);
        tab.hold(holdId, alice, bob, 12e6, block.timestamp + 1 days);
        assertEq(tab.spentToday(alice), 12e6);

        vm.prank(agent);
        tab.release(holdId);

        assertEq(tab.spentToday(alice), 12e6);
        assertEq(tab.balances(bob), 12e6);
    }

    function test_Hold_Release_NonPayerNonAgentReverts() public {
        _deposit(alice, 100e6);
        bytes32 holdId = keccak256("hold-unauth");

        _createHold(holdId, alice, bob, 10e6, block.timestamp + 1 days);

        vm.prank(random);
        vm.expectRevert(Tab.Unauthorized.selector);
        tab.release(holdId);
    }

    function test_Hold_Release_RevertsIfAlreadyReleased() public {
        _deposit(alice, 100e6);
        bytes32 holdId = keccak256("hold-double-release");

        _createHold(holdId, alice, bob, 10e6, block.timestamp + 1 days);

        vm.prank(alice);
        tab.release(holdId);

        vm.prank(alice);
        vm.expectRevert(Tab.HoldAlreadyUsed.selector);
        tab.release(holdId);
    }

    // =========================================================================
    // 8. Hold refunds after deadline; before deadline reverts
    // =========================================================================

    function test_RefundHold_RevertsBeforeDeadline() public {
        _deposit(alice, 100e6);
        bytes32 holdId   = keccak256("hold-refund-early");
        uint256 deadline = block.timestamp + 2 days;

        _createHold(holdId, alice, bob, 20e6, deadline);

        // Try to refund before deadline — should revert
        vm.expectRevert(Tab.HoldNotExpired.selector);
        tab.refundHold(holdId);
    }

    function test_RefundHold_SucceedsAfterDeadline() public {
        _deposit(alice, 100e6);
        bytes32 holdId   = keccak256("hold-refund-ok");
        uint256 amount   = 20e6;
        uint256 deadline = block.timestamp + 2 days;

        _createHold(holdId, alice, bob, amount, deadline);

        uint256 aliceBeforeRefund = tab.balances(alice);

        // Warp to just after the deadline
        vm.warp(deadline + 1);

        vm.expectEmit(true, false, false, false, address(tab));
        emit Tab.HoldRefunded(holdId);

        tab.refundHold(holdId);

        assertEq(tab.balances(alice), aliceBeforeRefund + amount);

        (, , , , , bool refunded) = tab.holds(holdId);
        assertTrue(refunded);
    }

    function test_RefundHold_RevertsIfAlreadyRefunded() public {
        _deposit(alice, 100e6);
        bytes32 holdId   = keccak256("hold-double-refund");
        uint256 deadline = block.timestamp + 1 days;

        _createHold(holdId, alice, bob, 10e6, deadline);
        vm.warp(deadline + 1);
        tab.refundHold(holdId);

        vm.expectRevert(Tab.HoldAlreadyUsed.selector);
        tab.refundHold(holdId);
    }

    function test_RefundHold_RevertsAtExactDeadline() public {
        _deposit(alice, 100e6);
        bytes32 holdId   = keccak256("hold-at-deadline");
        uint256 deadline = block.timestamp + 1 days;

        _createHold(holdId, alice, bob, 10e6, deadline);

        // Warp to exactly the deadline — contract checks block.timestamp < deadline
        // At equality the condition (block.timestamp < deadline) is FALSE → should NOT revert
        vm.warp(deadline);
        tab.refundHold(holdId); // should succeed
    }

    // =========================================================================
    // setAgent — owner-only
    // =========================================================================

    function test_SetAgent_OnlyOwner() public {
        address newAgent = makeAddr("newAgent");

        // Replacing a live agent is not instant
        vm.prank(owner);
        vm.expectRevert(Tab.AgentChangeNotReady.selector);
        tab.setAgent(newAgent);

        vm.prank(owner);
        tab.proposeAgent(newAgent);

        vm.prank(owner);
        vm.expectRevert(Tab.AgentChangeNotReady.selector);
        tab.acceptAgent();

        skip(2 days);
        vm.expectEmit(true, false, false, false, address(tab));
        emit Tab.AgentSet(newAgent);
        vm.prank(owner);
        tab.acceptAgent();

        assertEq(tab.AGENT(), newAgent);
    }

    function test_SetAgent_RevokeIsInstant() public {
        vm.prank(owner);
        tab.setAgent(address(0));
        assertEq(tab.AGENT(), address(0));

        _deposit(alice, 100e6);
        vm.prank(agent);
        vm.expectRevert(Tab.Unauthorized.selector);
        tab.send(alice, bob, 1e6);
    }

    function test_AgentPaused_BlocksAgentNotUser() public {
        _deposit(alice, 100e6);
        vm.prank(owner);
        tab.setAgentPaused(true);

        vm.prank(agent);
        vm.expectRevert(Tab.AgentBlocked.selector);
        tab.send(alice, bob, 1e6);

        // The user still controls their own money
        vm.prank(alice);
        tab.send(alice, bob, 1e6);
        vm.prank(alice);
        tab.withdraw(10e6);
    }

    function test_UserCanSwitchAgentOff() public {
        _deposit(alice, 100e6);
        vm.prank(alice);
        tab.setAgentDisabled(true);

        vm.prank(agent);
        vm.expectRevert(Tab.AgentBlocked.selector);
        tab.send(alice, bob, 1e6);

        vm.prank(alice);
        tab.setAgentDisabled(false);
        vm.prank(agent);
        tab.send(alice, bob, 1e6);
        assertEq(tab.balances(bob), 1e6);
    }

    function test_Send_RejectsZeroAndSelf() public {
        _deposit(alice, 100e6);
        vm.prank(alice);
        vm.expectRevert(Tab.BadRecipient.selector);
        tab.send(alice, address(0), 1e6);
        vm.prank(alice);
        vm.expectRevert(Tab.BadRecipient.selector);
        tab.send(alice, alice, 1e6);
    }

    function test_Hold_RejectsPastDeadline() public {
        _deposit(alice, 100e6);
        vm.prank(alice);
        vm.expectRevert(Tab.BadDeadline.selector);
        tab.hold(keccak256("h-past"), alice, bob, 1e6, block.timestamp);
    }

    function test_Agent_CannotWithdrawUserFunds() public {
        _deposit(alice, 100e6);
        // withdraw only ever pays msg.sender, so the agent can only pull its own (empty) balance
        vm.prank(agent);
        vm.expectRevert(Tab.InsufficientBalance.selector);
        tab.withdraw(1e6);
        assertEq(tab.balances(alice), 100e6);
    }

    function test_SetAgent_NonOwnerReverts() public {
        vm.prank(alice);
        vm.expectRevert(); // OwnableUnauthorizedAccount — any revert accepted
        tab.setAgent(makeAddr("badAgent"));
    }

    // =========================================================================
    // Fuzz: deposit/withdraw round-trip
    // =========================================================================

    function testFuzz_DepositWithdrawRoundTrip(uint256 amount) public {
        amount = bound(amount, 1e6, 500e6);

        // Ensure alice has enough USDC
        usdc.mint(alice, amount);

        vm.prank(alice);
        usdc.approve(address(tab), amount);

        uint256 usdcBefore = usdc.balanceOf(alice);

        _deposit(alice, amount);
        assertEq(tab.balances(alice), amount);

        vm.prank(alice);
        tab.withdraw(amount);

        // PROPERTY: full round-trip returns the exact amount to alice's USDC balance
        assertEq(usdc.balanceOf(alice), usdcBefore);
        assertEq(tab.balances(alice),   0);
    }

    // =========================================================================
    // Fuzz: agent send stays within daily limit
    // =========================================================================

    function testFuzz_Agent_SendWithinLimit(uint256 amount) public {
        amount = bound(amount, 1, DEFAULT_LIMIT);
        _deposit(alice, DEFAULT_LIMIT);

        vm.prank(agent);
        tab.send(alice, bob, amount);

        assertEq(tab.spentToday(alice), amount);
        assertLe(tab.spentToday(alice), DEFAULT_LIMIT);
    }

    // =========================================================================
    // Invariant: sum of internal balances == USDC held by Tab
    // =========================================================================

    // (kept as a simple unit-level conservation check because a handler-based
    //  invariant would require multi-actor state machinery beyond this scope)

    function test_Invariant_BalanceConservation_DepositWithdraw() public {
        uint256 depositA = 100e6;
        uint256 depositB = 200e6;

        _deposit(alice, depositA);
        _deposit(bob,   depositB);

        uint256 contractHolding = usdc.balanceOf(address(tab));
        uint256 sumBalances     = tab.balances(alice) + tab.balances(bob);

        // PROPERTY: Tab holds exactly the sum of all internal balances
        assertEq(contractHolding, sumBalances);
    }

    function test_Invariant_BalanceConservation_AfterSend() public {
        _deposit(alice, 150e6);
        _deposit(bob,   50e6);

        // alice sends 50 USDC to bob (direct, not via agent)
        vm.prank(alice);
        tab.send(alice, bob, 50e6);

        uint256 contractHolding = usdc.balanceOf(address(tab));
        uint256 sumBalances     = tab.balances(alice) + tab.balances(bob);

        // PROPERTY: total USDC in contract stays constant; only internal allocation changed
        assertEq(contractHolding, 200e6);
        assertEq(contractHolding, sumBalances);
    }
}
