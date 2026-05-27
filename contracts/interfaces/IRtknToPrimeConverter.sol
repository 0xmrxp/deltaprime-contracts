// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

interface IRtknToPrimeConverter {
    function users(uint256 index) external view returns (address);
    function getTotalUsers() external view returns (uint256);
    function previewFuturePrimeAmountBasedOnPledgedAmountForUser(address user) external view returns (uint256);
}
