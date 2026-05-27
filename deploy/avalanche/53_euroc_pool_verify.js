import verifyContract from "../../tools/scripts/verify-contract";
import hre from "hardhat";

const { tenderly } = require("hardhat");

const TIMELOCK_ADMIN = "0x5C31bF6E2E9565B854E7222742A9a8e3f78ff358";

module.exports = async ({ deployments }) => {
    const { get } = deployments;

    const eurocPool = await get("EurocPool");
    const eurocPoolTUP = await get("EurocPoolTUP");
    const eurocBorrowIndex = await get("EurocBorrowIndex");
    const eurocBorrowIndexTUP = await get("EurocBorrowIndexTUP");
    const eurocDepositIndex = await get("EurocDepositIndex");
    const eurocDepositIndexTUP = await get("EurocDepositIndexTUP");
    const eurocRatesCalc = await get("EurocVariableUtilisationRatesCalculator");

    const contracts = [
        {
            name: "EurocPool",
            address: eurocPool.address,
            contractPath: "contracts/deployment/avalanche/EurocPool.sol:EurocPool",
            constructorArguments: [],
        },
        {
            name: "EurocPoolTUP",
            address: eurocPoolTUP.address,
            contractPath: "contracts/proxies/tup/avalanche/EurocPoolTUP.sol:EurocPoolTUP",
            constructorArguments: [eurocPool.address, TIMELOCK_ADMIN, []],
        },
        {
            name: "EurocBorrowIndex",
            address: eurocBorrowIndex.address,
            contractPath: "contracts/deployment/avalanche/EurocBorrowIndex.sol:EurocBorrowIndex",
            constructorArguments: [],
        },
        {
            name: "EurocBorrowIndexTUP",
            address: eurocBorrowIndexTUP.address,
            contractPath: "contracts/proxies/tup/avalanche/EurocBorrowIndexTUP.sol:EurocBorrowIndexTUP",
            constructorArguments: [eurocBorrowIndex.address, TIMELOCK_ADMIN, []],
        },
        {
            name: "EurocDepositIndex",
            address: eurocDepositIndex.address,
            contractPath: "contracts/deployment/avalanche/EurocDepositIndex.sol:EurocDepositIndex",
            constructorArguments: [],
        },
        {
            name: "EurocDepositIndexTUP",
            address: eurocDepositIndexTUP.address,
            contractPath: "contracts/proxies/tup/avalanche/EurocDepositIndexTUP.sol:EurocDepositIndexTUP",
            constructorArguments: [eurocDepositIndex.address, TIMELOCK_ADMIN, []],
        },
        {
            name: "EurocVariableUtilisationRatesCalculator",
            address: eurocRatesCalc.address,
            contractPath: "contracts/deployment/avalanche/EurocVariableUtilisationRatesCalculator.sol:EurocVariableUtilisationRatesCalculator",
            constructorArguments: [],
        },
    ];

    for (const contract of contracts) {
        // Etherscan verification with timeout
        console.log(`\nVerifying ${contract.name} at ${contract.address}...`);
        try {
            await Promise.race([
                verifyContract(hre, {
                    address: contract.address,
                    contract: contract.contractPath,
                    constructorArguments: contract.constructorArguments,
                }),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error("Verification timed out after 60s")), 60000)
                ),
            ]);
            console.log(`Verified ${contract.name}`);
        } catch (error) {
            console.error(`Failed to verify ${contract.name}:`, error.message);
        }

        // Tenderly verification
        try {
            console.log(`Tenderly verification of ${contract.name}...`);
            await Promise.race([
                tenderly.verify({
                    address: contract.address,
                    name: contract.contractPath,
                }),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error("Tenderly verification timed out after 60s")), 60000)
                ),
            ]);
            console.log(`Tenderly verified ${contract.name}`);
        } catch (error) {
            console.error(`Failed Tenderly verification for ${contract.name}:`, error.message);
        }
    }

    console.log("\n=== Verification Complete ===");
};

module.exports.tags = ["euroc-pool-verify"];
