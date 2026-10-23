// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract Tab is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error OverDailyLimit();
    error Unauthorized();
    error ClaimAlreadyUsed();
    error ClaimNotExpired();
    error HoldAlreadyUsed();
    error HoldNotExpired();
    error InvalidSplit();
    error AlreadyPaid();
    error SplitAlreadyClosed();
    error InsufficientBalance();
    error ZeroAmount();
    error AgentBlocked();
    error BadRecipient();
    error BadSignature();
    error BadDeadline();
    error AgentChangeNotReady();

    struct Claim {
        address sender;
        address claimKey; // one-time key from the claim link; only its signature can claim
        uint256 amount;
        bool claimed;
        bool refunded;
        uint256 createdAt;
    }

    struct Split {
        address creator;
        address[] payers;
        uint256[] shares;
        mapping(address => bool) paid;
        uint256 paidCount;
        bool closed;
    }

    struct Hold {
        address payer;
        address payee;
        uint256 amount;
        uint256 deadline;
        bool released;
        bool refunded;
    }

    IERC20 public immutable usdc;
    uint256 public constant DEFAULT_DAILY_LIMIT = 20e6;

    address public AGENT;
    uint256 public constant AGENT_CHANGE_DELAY = 2 days;
    address public pendingAgent;
    uint256 public pendingAgentEta;
    bool public agentPaused;
    mapping(address => bool) public agentDisabled;

    mapping(address => uint256) public balances;
    mapping(address => uint256) public dailyLimit;
    mapping(address => uint256) public spentToday;
    mapping(address => uint256) public lastSpendDay;

    mapping(bytes32 => Claim) public claims;
    mapping(bytes32 => Split) internal splits;
    mapping(bytes32 => mapping(address => uint256)) internal splitShares;
    mapping(bytes32 => Hold) public holds;

    event AgentSet(address indexed agent);
    event AgentProposed(address indexed agent, uint256 eta);
    event AgentPaused(bool paused);
    event AgentDisabledFor(address indexed user, bool disabled);
    event DailyLimitSet(address indexed user, uint256 amount);

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event Sent(address indexed from, address indexed to, uint256 amount);

    event ClaimCreated(bytes32 indexed claimId, address indexed from, uint256 amount);
    event Claimed(bytes32 indexed claimId, address indexed recipient);
    event ClaimRefunded(bytes32 indexed claimId);

    event SplitCreated(bytes32 indexed splitId, address indexed creator, address[] payers, uint256[] shares);
    event SplitPaid(bytes32 indexed splitId, address indexed payer, uint256 share);
    event SplitClosed(bytes32 indexed splitId);

    event HoldCreated(bytes32 indexed holdId, address indexed from, address indexed to, uint256 amount, uint256 deadline);
    event HoldReleased(bytes32 indexed holdId);
    event HoldRefunded(bytes32 indexed holdId);

    constructor(address usdcAddress, address initialOwner) Ownable(initialOwner) {
        if (usdcAddress == address(0)) revert ZeroAmount();
        if (usdcAddress.code.length == 0) revert ZeroAmount();
        usdc = IERC20(usdcAddress);
    }

    modifier agentOrUser(address user, uint256 amount) {
        if (msg.sender == AGENT && AGENT != address(0)) {
            _agentGuard(user);
            _checkAndUpdateSpend(user, amount);
        } else if (msg.sender != user) {
            revert Unauthorized();
        }
        _;
    }

    /// First agent is set instantly. Revoking (address(0)) is always instant.
    /// Replacing a live agent needs proposeAgent + a 2 day wait, so a stolen
    /// owner key can't silently swap in its own agent.
    function setAgent(address newAgent) external onlyOwner {
        if (AGENT != address(0) && newAgent != address(0)) revert AgentChangeNotReady();
        AGENT = newAgent;
        pendingAgent = address(0);
        pendingAgentEta = 0;
        emit AgentSet(newAgent);
    }

    function proposeAgent(address newAgent) external onlyOwner {
        pendingAgent = newAgent;
        pendingAgentEta = block.timestamp + AGENT_CHANGE_DELAY;
        emit AgentProposed(newAgent, pendingAgentEta);
    }

    function acceptAgent() external onlyOwner {
        if (pendingAgentEta == 0 || block.timestamp < pendingAgentEta) revert AgentChangeNotReady();
        AGENT = pendingAgent;
        pendingAgent = address(0);
        pendingAgentEta = 0;
        emit AgentSet(AGENT);
    }

    /// Emergency brake: stops every agent action at once. Users keep full control.
    function setAgentPaused(bool paused) external onlyOwner {
        agentPaused = paused;
        emit AgentPaused(paused);
    }

    /// Any user can switch the agent off for their own account.
    function setAgentDisabled(bool disabled) external {
        agentDisabled[msg.sender] = disabled;
        emit AgentDisabledFor(msg.sender, disabled);
    }

    function setDailyLimit(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        dailyLimit[msg.sender] = amount;
        emit DailyLimitSet(msg.sender, amount);
    }

    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        usdc.safeTransferFrom(msg.sender, address(this), amount);

        balances[msg.sender] += amount;
        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (balances[msg.sender] < amount) revert InsufficientBalance();

        balances[msg.sender] -= amount;

        usdc.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount);
    }

    function send(address from, address to, uint256 amount) external nonReentrant agentOrUser(from, amount) {
        if (amount == 0) revert ZeroAmount();
        if (to == address(0) || to == from) revert BadRecipient();
        if (balances[from] < amount) revert InsufficientBalance();

        balances[from] -= amount;
        balances[to] += amount;

        emit Sent(from, to, amount);
    }

    function sendToClaim(address from, bytes32 claimId, uint256 amount, address claimKey)
        external
        nonReentrant
        agentOrUser(from, amount)
    {
        if (amount == 0) revert ZeroAmount();
        if (claimKey == address(0)) revert BadRecipient();
        if (balances[from] < amount) revert InsufficientBalance();

        Claim storage c = claims[claimId];
        if (c.createdAt != 0 || c.claimed || c.refunded) revert ClaimAlreadyUsed();

        balances[from] -= amount;

        c.sender = from;
        c.claimKey = claimKey;
        c.amount = amount;
        c.claimed = false;
        c.refunded = false;
        c.createdAt = block.timestamp;

        emit ClaimCreated(claimId, from, amount);
    }

    /// Anyone can relay a claim, but only the holder of the link's one-time key
    /// can choose the recipient. The signature binds the recipient, so a relayer
    /// or mempool watcher can't redirect the funds.
    function claim(bytes32 claimId, address recipient, bytes calldata signature) external nonReentrant {
        Claim storage c = claims[claimId];
        if (c.createdAt == 0 || c.claimed || c.refunded) revert ClaimAlreadyUsed();
        if (recipient == address(0)) revert BadRecipient();
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(claimDigest(claimId, recipient));
        if (ECDSA.recover(digest, signature) != c.claimKey) revert BadSignature();

        c.claimed = true;
        balances[recipient] += c.amount;

        emit Claimed(claimId, recipient);
    }

    function refundClaim(bytes32 claimId) external nonReentrant {
        Claim storage c = claims[claimId];
        if (c.createdAt == 0 || c.claimed || c.refunded) revert ClaimAlreadyUsed();
        if (block.timestamp < c.createdAt + 7 days) revert ClaimNotExpired();

        c.refunded = true;
        balances[c.sender] += c.amount;

        emit ClaimRefunded(claimId);
    }

    function createSplit(bytes32 splitId, address creator, address[] calldata payers, uint256[] calldata shares)
        external
        nonReentrant
        agentOrUser(creator, 0)
    {
        if (payers.length == 0 || payers.length != shares.length) revert InvalidSplit();
        if (creator == address(0)) revert InvalidSplit();

        Split storage s = splits[splitId];
        if (s.creator != address(0) || s.payers.length != 0) revert InvalidSplit();

        uint256 len = payers.length;
        for (uint256 i = 0; i < len; i++) {
            if (shares[i] == 0 || payers[i] == address(0)) revert InvalidSplit();
            for (uint256 j = i + 1; j < len; j++) {
                if (payers[i] == payers[j]) revert InvalidSplit();
            }

            s.payers.push(payers[i]);
            s.shares.push(shares[i]);
            splitShares[splitId][payers[i]] = shares[i];
        }

        s.creator = creator;

        emit SplitCreated(splitId, creator, payers, shares);
    }

    function paySplit(bytes32 splitId, address payer)
        external
        nonReentrant
        agentOrUser(payer, _splitShareOrRevert(splitId, payer))
    {
        Split storage s = splits[splitId];
        if (s.creator == address(0)) revert InvalidSplit();
        if (s.closed) revert SplitAlreadyClosed();
        if (s.paid[payer]) revert AlreadyPaid();

        uint256 share = _splitShareOrRevert(splitId, payer);
        if (balances[payer] < share) revert InsufficientBalance();

        balances[payer] -= share;
        balances[s.creator] += share;

        s.paid[payer] = true;
        s.paidCount += 1;

        emit SplitPaid(splitId, payer, share);

        if (s.paidCount == s.payers.length) {
            s.closed = true;
            emit SplitClosed(splitId);
        }
    }

    function hold(bytes32 holdId, address from, address to, uint256 amount, uint256 deadline)
        external
        nonReentrant
        agentOrUser(from, amount)
    {
        if (amount == 0) revert ZeroAmount();
        if (to == address(0) || to == from) revert BadRecipient();
        if (deadline <= block.timestamp) revert BadDeadline();
        if (balances[from] < amount) revert InsufficientBalance();

        Hold storage h = holds[holdId];
        if (h.amount != 0 || h.released || h.refunded) revert HoldAlreadyUsed();

        balances[from] -= amount;

        h.payer = from;
        h.payee = to;
        h.amount = amount;
        h.deadline = deadline;
        h.released = false;
        h.refunded = false;

        emit HoldCreated(holdId, from, to, amount, deadline);
    }

    function release(bytes32 holdId) external nonReentrant {
        Hold storage h = holds[holdId];
        if (h.amount == 0 || h.released || h.refunded) revert HoldAlreadyUsed();

        if (msg.sender == AGENT && AGENT != address(0)) {
            // The amount already counted against the daily limit when it was held.
            _agentGuard(h.payer);
        } else if (msg.sender != h.payer) {
            revert Unauthorized();
        }

        h.released = true;
        balances[h.payee] += h.amount;

        emit HoldReleased(holdId);
    }

    function refundHold(bytes32 holdId) external nonReentrant {
        Hold storage h = holds[holdId];
        if (h.amount == 0 || h.released || h.refunded) revert HoldAlreadyUsed();
        if (block.timestamp < h.deadline) revert HoldNotExpired();

        h.refunded = true;
        balances[h.payer] += h.amount;

        emit HoldRefunded(holdId);
    }

    function getSplitMeta(bytes32 splitId) external view returns (address creator, uint256 payerCount, uint256 paidCount, bool closed) {
        Split storage s = splits[splitId];
        return (s.creator, s.payers.length, s.paidCount, s.closed);
    }

    function getSplitPayers(bytes32 splitId) external view returns (address[] memory) {
        return splits[splitId].payers;
    }

    function getSplitShares(bytes32 splitId) external view returns (uint256[] memory) {
        return splits[splitId].shares;
    }

    function getSplitShare(bytes32 splitId, address payer) external view returns (uint256) {
        return _splitShareOrRevert(splitId, payer);
    }

    function isSplitPayerPaid(bytes32 splitId, address payer) external view returns (bool) {
        return splits[splitId].paid[payer];
    }

    function claimDigest(bytes32 claimId, address recipient) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), claimId, recipient));
    }

    function _agentGuard(address user) internal view {
        if (agentPaused || agentDisabled[user]) revert AgentBlocked();
    }

    function _checkAndUpdateSpend(address user, uint256 amount) internal {
        uint256 day = block.timestamp / 1 days;

        if (day > lastSpendDay[user]) {
            spentToday[user] = 0;
            lastSpendDay[user] = day;
        }

        uint256 limit = dailyLimit[user];
        if (limit == 0) {
            limit = DEFAULT_DAILY_LIMIT;
        }

        if (spentToday[user] + amount > limit) revert OverDailyLimit();

        spentToday[user] += amount;
    }

    function _splitShareOrRevert(bytes32 splitId, address payer) internal view returns (uint256) {
        uint256 share = splitShares[splitId][payer];
        if (share == 0) revert InvalidSplit();
        return share;
    }
}
