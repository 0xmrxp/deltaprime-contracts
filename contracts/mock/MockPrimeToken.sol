// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @dev Simple ERC20 mock for testing. Mints initial supply to a recipient.
 */
contract MockPrimeToken is ERC20 {
    constructor(address recipient, uint256 initialSupply) ERC20("Mock PRIME", "PRIME") {
        _mint(recipient, initialSupply);
    }
}
