// SPDX-License-Identifier: BUSL-1.1
// Last deployed from commit: ab0885e12c84fa9d3f0a7206af57350bca360edb;
pragma solidity 0.8.17;

import "../avalanche/YieldYakSwapFacet.sol";

contract YieldYakSwapArbitrumFacet is YieldYakSwapFacet {
    function YY_ROUTER() internal override pure returns (address) {
        return 0xb32C79a25291265eF240Eb32E9faBbc6DcEE3cE3;
    }
}
