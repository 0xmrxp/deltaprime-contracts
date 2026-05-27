// SPDX-License-Identifier: BUSL-1.1
// Last deployed from commit: d17bd989c2fce50ce8c24129c5bc70ae4d395e02;
pragma solidity 0.8.17;

import "../SolvencyFacetProd.sol";

// All RedStone data-service configuration (data service id, authorised signer
// set, and unique-signer threshold) is inherited from SolvencyFacetProd, which
// extends PrimaryProdDataServiceConsumerBase ("redstone-primary-prod"). No
// chain-specific override is required: both Arbitrum and Avalanche now consume
// prices from the same RedStone primary node.
contract SolvencyFacetProdArbitrum is SolvencyFacetProd {}
