// SPDX-License-Identifier: BUSL-1.1
// Last deployed from commit: 56b7ba6f74e4dd5f903aad49110b5db8a353f45f;
pragma solidity 0.8.17;

//This path is updated during deployment
import "../GmxV2CallbacksFacet.sol";

contract GmxV2CallbacksFacetArbitrum is GmxV2CallbacksFacet {
    using TransferHelper for address;

    // https://github.com/gmx-io/gmx-synthetics/blob/main/deployments/arbitrum/
    // GMX contracts

    function getGmxV2RoleStore() internal pure override returns (address) {
        return 0x3c3d99FD298f679DBC2CEcd132b4eC4d0F5e6e72;
    }
}
