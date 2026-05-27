// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.8.17;

//This path is updated during deployment
import "../GlvFacet.sol";
// import {IGlvFacet} from "../../interfaces/facets/Arbitrum/IGlvFacet.sol";

contract GlvFacetArbitrum is GlvFacet {
    using TransferHelper for address;

    // https://github.com/gmx-io/gmx-synthetics/tree/v2.3-branch/deployments/arbitrum
    // Glv contracts
    function getGlvRouter() internal pure override returns (address) {
        return 0x7EAdEE2ca1b4D06a0d82fDF03D715550c26AA12F;
    }

    function getGmxV2Router() internal pure override returns (address) {
        return 0x7452c558d45f8afC8c83dAe62C3f8A5BE19c71f6;
    }

    function getGmxV2GlvDepositVault() internal pure override returns (address) {
        return 0x393053B58f9678C9c28c2cE941fF6cac49C3F8f9;
    }
    ///@dev both Deposit and Withdrawal vaults seem to be the same on Arbitrum?
    function getGmxV2GlvWithdrawalVault() internal pure override returns (address) {
        return 0x393053B58f9678C9c28c2cE941fF6cac49C3F8f9;
    }

    // GLV Token
    address constant GLV_WETH_USDC = 0x528A5bac7E746C9A509A1f4F6dF58A03d44279F9;
    address constant GLV_BTC_USDC = 0xdF03EEd325b82bC1d4Db8b49c30ecc9E05104b96;

    // Tokens
    address constant WETH = 0x82aF49447D8a07e3bd95BD0d56f35241523fBab1;
    address constant USDC = 0xaf88d065e77c8cC2239327C5EDb3A432268e5831;
    address constant WBTC = 0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f;


    // DEPOSIT
    function depositWethUsdcGlv(
        bool isLongToken,
        uint256 tokenAmount,
        uint256 minGlvAmount,
        address targetMarket,
        uint256 executionFee
    ) external payable {
        address _depositedToken = isLongToken ? WETH : USDC;

        _depositGlv(
            GLV_WETH_USDC,
            _depositedToken,
            tokenAmount,
            targetMarket,
            minGlvAmount,
            executionFee
        );
    }

    function depositBtcUsdcGlv(
        bool isLongToken,
        uint256 tokenAmount,
        uint256 minGlvAmount,
        address targetMarket,
        uint256 executionFee
    ) external payable {
        address _depositedToken = isLongToken ? WBTC : USDC;

        _depositGlv(
            GLV_BTC_USDC,
            _depositedToken,
            tokenAmount,
            targetMarket,
            minGlvAmount,
            executionFee
        );
    }


    // WITHDRAW
    function withdrawWethUsdcGlv(
        uint256 glvAmount,
        address targetMarket,
        uint256 minLongTokenAmount,
        uint256 minShortTokenAmount,
        uint256 executionFee
    ) external payable {
        _withdrawGlv(
            GLV_WETH_USDC,
            glvAmount,
            targetMarket,
            minLongTokenAmount,
            minShortTokenAmount,
            executionFee
        );
    }

    function withdrawBtcUsdcGlv(
        uint256 glvAmount,
        address targetMarket,
        uint256 minLongTokenAmount,
        uint256 minShortTokenAmount,
        uint256 executionFee
    ) external payable {
        _withdrawGlv(
            GLV_BTC_USDC,
            glvAmount,
            targetMarket,
            minLongTokenAmount,
            minShortTokenAmount,
            executionFee
        );
    }

}
