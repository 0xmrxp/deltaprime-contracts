// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../interfaces/IRtknToPrimeConverter.sol";

/**
 * @dev Mock RtknToPrimeConverter for testing ReusablePrimeDistributor.
 */
contract MockRtknToPrimeConverter is IRtknToPrimeConverter {
    address[] public users;
    mapping(address => uint256) public pledgedAmounts;

    uint256 public constant CONVERSION_RATIO = 0.808015513897867e18;

    function addUser(address user, uint256 pledgedAmount) external {
        if (pledgedAmounts[user] == 0) {
            users.push(user);
        }
        pledgedAmounts[user] = pledgedAmount;
    }

    function getTotalUsers() external view returns (uint256) {
        return users.length;
    }

    function previewFuturePrimeAmountBasedOnPledgedAmountForUser(address user) external view returns (uint256) {
        return (pledgedAmounts[user] * CONVERSION_RATIO) / 1e18;
    }
}
