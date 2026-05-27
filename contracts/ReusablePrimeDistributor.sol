// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./interfaces/IRtknToPrimeConverter.sol";

/**
 * @title ReusablePrimeDistributor
 * @dev Deploy-once contract for recurring PRIME token distributions to rTKN-to-PRIME converters.
 *
 * Usage:
 *   1. Deploy once per rTKNConverter instance (1 on Avalanche, 2 on Arbitrum)
 *   2. Call cacheUsers() in batches to snapshot user shares from the converter
 *   3. Each distribution round: send PRIME to this contract, call startRound(), call distribute()
 *
 * Distribution cap:
 *   Every instance enforces a hard cap on the total PRIME it will ever pay out,
 *   equal to `distributionCap` (set at construction from the converter's
 *   totalrTKNPledged × CONVERSION_RATIO). `initialDistributed` accounts for PRIME
 *   already paid out via prior single-use PrimeRtknAirdropDistributor contracts for
 *   the same converter. startRound() clips each round to the remaining headroom;
 *   any PRIME sent in above the cap stays in the contract as sweepable dust.
 */
contract ReusablePrimeDistributor is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable primeToken;
    IRtknToPrimeConverter public immutable rTKNConverter;

    // --- Distribution cap (lifetime cap enforced across all rounds) ---
    uint256 public immutable distributionCap;
    uint256 public immutable initialDistributed;

    // --- User cache (populated once via cacheUsers) ---
    address[] public cachedUsers;
    mapping(address => uint256) public userShare;
    uint256 public totalShares;
    uint256 public cachingIndex;
    bool public usersCached;

    // --- Distribution round state ---
    uint256 public currentRound;
    uint256 public roundPrimeAmount;
    uint256 public currentDistributionIndex;
    bool public roundInProgress;

    // --- Cumulative tracking ---
    uint256 public totalPrimeDistributed;
    mapping(address => uint256) public userTotalReceived;

    // --- Skip list (for users whose transfers would revert, e.g. token blocklist) ---
    mapping(address => bool) public skippedUsers;

    // --- Events ---
    event UsersCached(uint256 totalUsers, uint256 totalShares);
    event RoundStarted(uint256 indexed round, uint256 primeAmount);
    event TokensDistributed(uint256 indexed round, address indexed user, uint256 amount);
    event UserSkippedStatusChanged(address indexed user, bool skipped);
    event RoundCompleted(uint256 indexed round, uint256 totalDistributed, uint256 dust);
    event EmergencyWithdraw(address indexed token, address indexed recipient, uint256 amount);

    constructor(
        address _primeToken,
        address _rTKNConverter,
        uint256 _distributionCap,
        uint256 _initialDistributed
    ) {
        require(_primeToken != address(0), "Invalid PRIME token address");
        require(_rTKNConverter != address(0), "Invalid rTKNConverter address");
        require(_distributionCap > 0, "Cap must be > 0");
        require(_initialDistributed <= _distributionCap, "initialDistributed > cap");

        primeToken = IERC20(_primeToken);
        rTKNConverter = IRtknToPrimeConverter(_rTKNConverter);
        distributionCap = _distributionCap;
        initialDistributed = _initialDistributed;
    }

    // ========================
    //  One-time setup
    // ========================

    /**
     * @dev Cache users and their shares from the rTKNConverter. Call in batches until complete.
     *      User data in the converter is frozen (Phase2 completed), so this only needs to run once.
     * @param batchSize Number of users to process in this batch
     */
    function cacheUsers(uint256 batchSize) external onlyOwner {
        require(!usersCached, "Users already cached");
        require(batchSize > 0, "Batch size must be > 0");

        uint256 totalUsers = rTKNConverter.getTotalUsers();
        uint256 endIndex = cachingIndex + batchSize;
        if (endIndex > totalUsers) {
            endIndex = totalUsers;
        }

        for (uint256 i = cachingIndex; i < endIndex; i++) {
            address user = rTKNConverter.users(i);

            if (userShare[user] == 0) {
                uint256 share = rTKNConverter.previewFuturePrimeAmountBasedOnPledgedAmountForUser(user);
                if (share > 0) {
                    cachedUsers.push(user);
                    userShare[user] = share;
                    totalShares += share;
                }
            }
        }

        cachingIndex = endIndex;

        if (cachingIndex >= totalUsers) {
            usersCached = true;
            emit UsersCached(cachedUsers.length, totalShares);
        }
    }

    // ========================
    //  Distribution rounds
    // ========================

    /**
     * @dev Start a new distribution round. Snapshots the current PRIME balance for proportional distribution.
     *      Send PRIME to this contract before calling this function.
     *      The round amount is clipped to the remaining lifetime cap; any excess sits in the
     *      contract as dust and can be swept with emergencyWithdraw.
     */
    function startRound() external onlyOwner {
        require(usersCached, "Users not cached yet");
        require(!roundInProgress, "Round already in progress");

        uint256 paidSoFar = initialDistributed + totalPrimeDistributed;
        require(paidSoFar < distributionCap, "Cap reached");
        uint256 remaining = distributionCap - paidSoFar;

        uint256 balance = primeToken.balanceOf(address(this));
        require(balance > 0, "No PRIME to distribute");

        uint256 roundAmount = balance < remaining ? balance : remaining;

        currentRound++;
        roundPrimeAmount = roundAmount;
        currentDistributionIndex = 0;
        roundInProgress = true;

        emit RoundStarted(currentRound, roundAmount);
    }

    /**
     * @dev Distribute PRIME tokens to users in batches. Sends proportional amounts based on cached shares.
     * @param batchSize Number of users to distribute to in this batch
     */
    function distribute(uint256 batchSize) external onlyOwner nonReentrant {
        require(roundInProgress, "No round in progress");
        require(batchSize > 0, "Batch size must be > 0");

        uint256 endIndex = currentDistributionIndex + batchSize;
        uint256 userCount = cachedUsers.length;
        if (endIndex > userCount) {
            endIndex = userCount;
        }

        for (uint256 i = currentDistributionIndex; i < endIndex; i++) {
            address user = cachedUsers[i];
            if (skippedUsers[user]) {
                continue;
            }
            uint256 amount = (roundPrimeAmount * userShare[user]) / totalShares;

            if (amount > 0) {
                userTotalReceived[user] += amount;
                totalPrimeDistributed += amount;
                primeToken.safeTransfer(user, amount);
                emit TokensDistributed(currentRound, user, amount);
            }
        }

        currentDistributionIndex = endIndex;

        if (currentDistributionIndex >= userCount) {
            roundInProgress = false;
            uint256 dust = primeToken.balanceOf(address(this));
            emit RoundCompleted(currentRound, roundPrimeAmount, dust);
        }
    }

    /**
     * @dev Toggle the skip flag for a cached user. Skipped users are passed over in distribute(),
     *      allowing distribution to proceed when a specific user's transfer would revert
     *      (e.g. a future token blocklist). The user's share stays in the contract as dust.
     * @param user User to skip or unskip
     * @param skipped True to skip, false to re-include
     */
    function setUserSkipped(address user, bool skipped) external onlyOwner {
        skippedUsers[user] = skipped;
        emit UserSkippedStatusChanged(user, skipped);
    }

    // ========================
    //  Emergency
    // ========================

    /**
     * @dev Emergency withdraw any token. Resets round state if called mid-round.
     * @param token Address of the token to withdraw
     * @param recipient Address to receive the tokens
     */
    function emergencyWithdraw(address token, address recipient) external onlyOwner nonReentrant {
        require(recipient != address(0), "Invalid recipient");

        if (roundInProgress) {
            roundInProgress = false;
        }

        IERC20 tokenContract = IERC20(token);
        uint256 balance = tokenContract.balanceOf(address(this));
        if (balance > 0) {
            tokenContract.safeTransfer(recipient, balance);
            emit EmergencyWithdraw(token, recipient, balance);
        }
    }

    /**
     * @dev Prevent accidental ownership renunciation since the contract is meant to be permanently owned.
     */
    function renounceOwnership() public pure override {
        revert("Ownership renunciation disabled");
    }

    // ========================
    //  View functions
    // ========================

    function getTotalCachedUsers() external view returns (uint256) {
        return cachedUsers.length;
    }

    function getCachingProgress() external view returns (uint256 cached, uint256 total) {
        return (cachingIndex, rTKNConverter.getTotalUsers());
    }

    function getRoundProgress() external view returns (uint256 distributed, uint256 total) {
        return (currentDistributionIndex, cachedUsers.length);
    }

    function getUserTotalReceived(address user) external view returns (uint256) {
        return userTotalReceived[user];
    }

    function getCurrentPrimeBalance() external view returns (uint256) {
        return primeToken.balanceOf(address(this));
    }

    /**
     * @dev Lifetime PRIME still payable by this instance before the cap is reached.
     */
    function getRemainingDistributable() external view returns (uint256) {
        uint256 paidSoFar = initialDistributed + totalPrimeDistributed;
        if (paidSoFar >= distributionCap) return 0;
        return distributionCap - paidSoFar;
    }
}
