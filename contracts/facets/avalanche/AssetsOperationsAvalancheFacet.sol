// SPDX-License-Identifier: BUSL-1.1
// Last deployed from commit: 56b7ba6f74e4dd5f903aad49110b5db8a353f45f;
pragma solidity 0.8.17;

import "../AssetsOperationsFacet.sol";

contract AssetsOperationsAvalancheFacet is AssetsOperationsFacet {
    using TransferHelper for address payable;
    using TransferHelper for address;

    /**
    * Funds the loan with a specified amount of a GLP
    * @dev Requires approval for stakedGLP token on frontend side
    * @param _amount to be funded
    **/
    function fundGLP(uint256 _amount) public override onlyOwner nonReentrant noBorrowInTheSameBlock {
        IERC20Metadata stakedGlpToken = IERC20Metadata(0xaE64d55a6f09E4263421737397D1fdFA71896a69);
        _amount = Math.min(_amount, stakedGlpToken.balanceOf(msg.sender));
        address(stakedGlpToken).safeTransferFrom(msg.sender, address(this), _amount);
        if (stakedGlpToken.balanceOf(address(this)) > 0) {
            DiamondStorageLib.addOwnedAsset("GLP", address(stakedGlpToken));
        }

        ITokenManager tokenManager = DeploymentConstants.getTokenManager();

        _syncExposure(tokenManager, address(stakedGlpToken));

        emit Funded(msg.sender, "GLP", _amount, block.timestamp);
    }
}
