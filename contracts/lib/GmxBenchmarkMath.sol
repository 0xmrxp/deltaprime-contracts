// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {DiamondStorageLib} from "./DiamondStorageLib.sol";

/**
 * @title GmxBenchmarkMath
 * @notice External (DELEGATECALL-target) library holding the shared GMX V2 benchmark math:
 *         the premium-scaled pro-rata of a GM-token amount into its underlying long/short
 *         token amounts, and the deductible performance fee for a position.
 *
 *         The premium-scaled pro-rata makes the funded-delta contribution to a benchmark
 *         satisfy the same `longAmt * longPrice + shortAmt * shortPrice == amount * gmPrice`
 *         invariant that the full-balance variant in
 *         `GmxV2FeesHelper._getUnderlyingTokenDetails` maintains. Without it, an additive
 *         benchmark update under-counts the funded position's cost basis by the GM premium
 *         ratio, leaving a residual that gets charged as fee again on the next sweep.
 *
 * @dev    Lives in a separate deployed library rather than an inlined `internal` function
 *         because inlining the arithmetic pushes the AssetsOperations facets past the
 *         24 KB code-size limit. All external reads (`balanceOf`, `totalSupply`,
 *         `decimals`) are performed inside the library so they don't bloat each consuming
 *         facet. Called via DELEGATECALL, which preserves the calling facet's storage and
 *         msg.sender context.
 */
library GmxBenchmarkMath {
    /**
     * @notice Premium-scaled pro-rata of `gmTokenAmount` GM tokens in `gmMarket` into the
     *         underlying long/short token amounts that the benchmark should store.
     *
     * @param gmMarket          The GM market token address
     * @param gmTokenAmount     The GM-token amount whose pro-rata we want (e.g. the funded
     *                          delta on a fund() call, or the PA's full balance on a sweep)
     * @param longToken         Underlying long token address
     * @param shortToken        Underlying short token address (caller passes the SAME address
     *                          as longToken for Plus markets; the `isPlusMarket` flag zeroes
     *                          the short side)
     * @param gmTokenPrice      In 1e8 USD precision
     * @param longTokenPrice    In 1e8 USD precision
     * @param shortTokenPrice   In 1e8 USD precision (ignored for Plus markets)
     * @param isPlusMarket      If true, returns 0 for shortTokenAmount and excludes the short
     *                          side from the ratio denominator (mirrors the Plus-market
     *                          handling in `_getUnderlyingTokenDetails`)
     */
    function premiumScaledUnderlying(
        address gmMarket,
        uint256 gmTokenAmount,
        address longToken,
        address shortToken,
        uint256 gmTokenPrice,
        uint256 longTokenPrice,
        uint256 shortTokenPrice,
        bool isPlusMarket
    ) public view returns (uint256 longTokenAmount, uint256 shortTokenAmount) {
        uint256 totalGmSupply = IERC20Metadata(gmMarket).totalSupply();
        uint256 totalLongTokens = IERC20Metadata(longToken).balanceOf(gmMarket);
        uint256 totalShortTokens = isPlusMarket
            ? 0
            : IERC20Metadata(shortToken).balanceOf(gmMarket);

        // ratio = totalGmWorth / totalUnderlyingWorth, computed as one block to keep the
        // local-variable count low enough that solc-without-IR doesn't hit stack-too-deep.
        uint256 ratio;
        {
            uint256 totalUnderlyingWorth =
                totalLongTokens  * longTokenPrice  / 1e8 * 1e18 / 10 ** IERC20Metadata(longToken).decimals()
              + totalShortTokens * shortTokenPrice / 1e8 * 1e18 / 10 ** IERC20Metadata(shortToken).decimals();
            ratio = ((totalGmSupply * gmTokenPrice / 1e8) * 1e18) / totalUnderlyingWorth;
        }

        longTokenAmount  = (ratio * gmTokenAmount * totalLongTokens)  / (1e18 * totalGmSupply);
        shortTokenAmount = (ratio * gmTokenAmount * totalShortTokens) / (1e18 * totalGmSupply);
    }

    /// @dev Fee fraction applied to unrealized GM-token performance. 1e17 of 1e18 = 10%.
    uint256 private constant FEE_PERCENTAGE = 1e17;

    /**
     * @notice Computes the GMX V2 performance fee owed on a position, denominated in GM
     *         tokens. Single source of truth shared by:
     *           - `GmxV2FeesHelper._getDeductibleFeesInGmTokens` (the on-chain fee-sweep
     *             view, also used by SmartLoanViewFacet's net-of-fee balance helpers); and
     *           - `SolvencyFacetProd._getSolvencyBalance` (the solvency-side deduction of
     *             unrealized fee from collateral).
     *         Both call sites delegating here keeps the fee-sweep accounting and the
     *         solvency-side accounting from drifting apart.
     *
     * @dev    Reads the benchmark and the calling facet's GM-token balance from storage
     *         directly. Callers must pass the prices they want the fee evaluated against
     *         (those vary per call site: solvency uses prices fetched via the dual-oracle
     *         router; view callers may use spot prices).
     *
     * @param gmMarket          The GM/GLV market token whose position the fee is computed for
     * @param gmTokenPrice      1e8 USD precision
     * @param longTokenPrice    1e8 USD precision
     * @param shortTokenPrice   1e8 USD precision (caller passes 0 for Plus-markets)
     * @return feeInGmTokens    The 10%-of-unrealized-performance fee, denominated in GM tokens
     */
    function deductibleFeeInGmTokens(
        address gmMarket,
        uint256 gmTokenPrice,
        uint256 longTokenPrice,
        uint256 shortTokenPrice
    ) public view returns (uint256 feeInGmTokens) {
        DiamondStorageLib.GmxPositionBenchmark memory benchmark =
            DiamondStorageLib.getGmxPositionBenchmark(gmMarket);
        if (!benchmark.exists || gmTokenPrice == 0) return 0;

        uint256 currentBalance = IERC20Metadata(gmMarket).balanceOf(address(this));
        uint256 currentValueUsd = (currentBalance * gmTokenPrice) / 1e8;
        uint256 totalUnderlyingValueUsd =
            _underlyingValueUsd(benchmark.underlyingLongTokenAmount,  longTokenPrice,  benchmark.longTokenAddress)
          + _underlyingValueUsd(benchmark.underlyingShortTokenAmount, shortTokenPrice, benchmark.shortTokenAddress);

        if (currentValueUsd <= totalUnderlyingValueUsd) return 0;
        uint256 gmPerformanceUsd = currentValueUsd - totalUnderlyingValueUsd;
        // `gmPerformanceUsd / 10` is the bytecode-cheap equivalent of
        // `(gmPerformanceUsd * FEE_PERCENTAGE) / 1e18` while FEE_PERCENTAGE == 1e17.
        feeInGmTokens = ((gmPerformanceUsd / 10) * 1e8) / gmTokenPrice;
    }

    /// @dev Convert (tokenAmount in token's native decimals × priceUsd in 1e8) → USD in 1e18.
    ///      Mirrors the decimal handling in `GmxV2FeesHelper._calculateTokenValueUsd`.
    function _underlyingValueUsd(uint256 amount, uint256 priceUsd, address tokenAddr) private view returns (uint256) {
        if (amount == 0 || priceUsd == 0 || tokenAddr == address(0)) return 0;
        uint8 decimals = IERC20Metadata(tokenAddr).decimals();
        // The decimals == 18 case collapses into the <= 18 branch via 10**0 == 1.
        if (decimals <= 18) return (amount * priceUsd * (10 ** (18 - decimals))) / 1e8;
        return (amount * priceUsd) / (1e8 * (10 ** (decimals - 18)));
    }
}
