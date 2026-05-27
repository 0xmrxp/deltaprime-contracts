// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.8.17;


import "../GlvFacet.sol";


contract GlvFacetAvalanche is GlvFacet {
    using TransferHelper for address;

    // https://github.com/gmx-io/gmx-synthetics/tree/v2.3-branch/deployments/avalanche
    // Glv contracts
    function getGlvRouter() internal pure override returns (address) {
        return 0x7E425c47b2Ff0bE67228c842B9C792D0BCe58ae6;
    }

    function getGmxV2Router() internal pure override returns (address) {
        return 0x820F5FfC5b525cD4d88Cd91aCf2c28F16530Cc68;
    }

    function getGmxV2GlvDepositVault() internal pure override returns (address) {
        return 0x527FB0bCfF63C47761039bB386cFE181A92a4701;
    }

    function getGmxV2GlvWithdrawalVault() internal pure override returns (address) {
        return 0x527FB0bCfF63C47761039bB386cFE181A92a4701;
    }

    // GLV Token
    address constant GLV_WAVAX_USDC = 0x901eE57f7118A7be56ac079cbCDa7F22663A3874;

    // Tokens
    address constant WAVAX = 0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7;
    address constant USDC = 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E;


    // DEPOSIT
    function depositWavaxUsdcGlv(
        bool isLongToken,
        uint256 tokenAmount,
        uint256 minGlvAmount,
        address targetMarket,
        uint256 executionFee
    ) external payable {
        address _depositedToken = isLongToken ? WAVAX : USDC;

        _depositGlv(
            GLV_WAVAX_USDC,
            _depositedToken,
            tokenAmount,
            targetMarket,
            minGlvAmount,
            executionFee
        );
    }


    // WITHDRAW
    function withdrawWavaxUsdcGlv(
        uint256 glvAmount,
        address targetMarket,
        uint256 minLongTokenAmount,
        uint256 minShortTokenAmount,
        uint256 executionFee
    ) external payable {
        _withdrawGlv(
            GLV_WAVAX_USDC,
            glvAmount,
            targetMarket,
            minLongTokenAmount,
            minShortTokenAmount,
            executionFee
        );
    }

}
