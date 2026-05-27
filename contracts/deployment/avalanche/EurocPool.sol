// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

import "../../Pool.sol";


/**
 * @title EurocPool
 * @dev Contract allowing user to deposit to and borrow EUROC from a dedicated user account
 */
contract EurocPool is Pool {
    function name() public virtual override pure returns(string memory _name){
        _name = "DeltaPrimeEUROC";
    }

    function symbol() public virtual override pure returns(string memory _symbol){
        _symbol = "DPEUROC";
    }

    function decimals() public virtual override pure returns(uint8 decimals){
        decimals = 6;
    }
}
