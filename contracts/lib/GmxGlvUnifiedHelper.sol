// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

contract GmxGlvUnifiedHelper {

    // ============ ERRORS ============
    error InvalidGlvToken();
    error InvalidTargetMarket();
    error ZeroDepositAmount();
    error ZeroWithdrawalAmount();
    error GlvTokenNotWhitelisted();
    error GlvTokenNotFound();
    error WrongDepositToken();
    error DepositTokenInactive();

    error InsufficientBalanceAfterFees();
    error InsufficientBalance();
    error InvalidMinOutputValue();
    error ActionMayCauseInsolvency();
    error GmxPlusMarketTokenNotFound();
    error GmxMarketTokensNotFound();
    error InvalidExecutionFee();
    error MarketNotWhitelisted();


// Unified struct that works for both regular and Plus markets
    struct UnifiedGmxTokenPricesAndAddresses {
        uint256 gmTokenPrice;
        uint256 longTokenPrice;
        uint256 shortTokenPrice; // Always 0 for Plus markets
        address longToken;
        address shortToken; // Same as longToken for Plus markets
        bool isPlusMarket;
    }

    ///@notice GmxTokenPrices struct containing current prices of GM, long, and short tokens in USD (1e8 format)
    struct GmxTokenPrices {
        uint256 gmTokenPrice;
        uint256 longTokenPrice;
        uint256 shortTokenPrice;
    }
}