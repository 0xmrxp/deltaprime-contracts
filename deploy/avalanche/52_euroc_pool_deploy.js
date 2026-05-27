import { embedCommitHash } from "../../tools/scripts/embed-commit-hash";
import verifyContract from "../../tools/scripts/verify-contract";
import hre from "hardhat";
import { toBytes32 } from "../../test/_helpers";
import TOKEN_ADDRESSES from "../../common/addresses/avax/token_addresses.json";
import { ZERO_ADDRESS } from "@openzeppelin/test-helpers/src/constants";

const { ethers, tenderly } = require("hardhat");

const OWNER_MULTISIG = "0x44AfCcF712E8A097a6727B48b57c75d7A85a9B0c";
const TIMELOCK_ADMIN = "0x5C31bF6E2E9565B854E7222742A9a8e3f78ff358";

module.exports = async ({ getNamedAccounts, deployments }) => {
    const { deploy, get } = deployments;
    const { deployer } = await getNamedAccounts();

    // --- Embed commit hashes ---
    embedCommitHash("Pool", "./contracts");
    embedCommitHash("EurocPool", "./contracts/deployment/avalanche");
    embedCommitHash("EurocPoolTUP", "./contracts/proxies/tup/avalanche");
    embedCommitHash("EurocBorrowIndex", "./contracts/deployment/avalanche");
    embedCommitHash("EurocDepositIndex", "./contracts/deployment/avalanche");
    embedCommitHash("EurocVariableUtilisationRatesCalculator", "./contracts/deployment/avalanche");

    const deployedContracts = [];

    // --- Deploy EurocPool directly ---
    console.log("\nDeploying EurocPool...");
    let resultPool = await deploy("EurocPool", {
        from: deployer,
        gasLimit: 8000000,
        args: [],
        contract: "contracts/deployment/avalanche/EurocPool.sol:EurocPool",
    });

    deployedContracts.push({
        name: "EurocPool",
        address: resultPool.address,
        contractPath: "contracts/deployment/avalanche/EurocPool.sol:EurocPool",
        constructorArguments: [],
    });

    console.log(`EurocPool deployed at address: ${resultPool.address}`);

    // --- Deploy EurocPoolTUP (admin = timelock) ---
    console.log("\nDeploying EurocPoolTUP...");
    let resultTup = await deploy("EurocPoolTUP", {
        from: deployer,
        gasLimit: 8000000,
        args: [resultPool.address, TIMELOCK_ADMIN, []],
        contract: "contracts/proxies/tup/avalanche/EurocPoolTUP.sol:EurocPoolTUP",
    });

    deployedContracts.push({
        name: "EurocPoolTUP",
        address: resultTup.address,
        contractPath: "contracts/proxies/tup/avalanche/EurocPoolTUP.sol:EurocPoolTUP",
        constructorArguments: [resultPool.address, TIMELOCK_ADMIN, []],
    });

    console.log(`EurocPoolTUP deployed at address: ${resultTup.address}`);

    // --- Deploy linear indices (inlined, TUP admin = timelock) ---
    const eurocPoolTUPAddress = resultTup.address;

    // EurocBorrowIndex
    console.log("\nDeploying EurocBorrowIndex...");
    let resultBorrowIndex = await deploy("EurocBorrowIndex", {
        from: deployer,
        gasLimit: 8000000,
        args: [],
    });
    console.log(`EurocBorrowIndex deployed at address: ${resultBorrowIndex.address}`);

    let resultBorrowIndexTUP = await deploy("EurocBorrowIndexTUP", {
        from: deployer,
        gasLimit: 8000000,
        args: [resultBorrowIndex.address, TIMELOCK_ADMIN, []],
    });
    console.log(`EurocBorrowIndexTUP deployed at address: ${resultBorrowIndexTUP.address}`);

    const borrowIndexFactory = await ethers.getContractFactory("EurocBorrowIndex");
    let initBorrowTx = await borrowIndexFactory.attach(resultBorrowIndexTUP.address).initialize(
        eurocPoolTUPAddress,
        { gasLimit: 8000000 }
    );
    await initBorrowTx.wait();
    console.log(`EurocBorrowIndex initialized with pool: ${eurocPoolTUPAddress}`);

    // EurocDepositIndex
    console.log("\nDeploying EurocDepositIndex...");
    let resultDepositIndex = await deploy("EurocDepositIndex", {
        from: deployer,
        gasLimit: 8000000,
        args: [],
    });
    console.log(`EurocDepositIndex deployed at address: ${resultDepositIndex.address}`);

    let resultDepositIndexTUP = await deploy("EurocDepositIndexTUP", {
        from: deployer,
        gasLimit: 8000000,
        args: [resultDepositIndex.address, TIMELOCK_ADMIN, []],
    });
    console.log(`EurocDepositIndexTUP deployed at address: ${resultDepositIndexTUP.address}`);

    const depositIndexFactory = await ethers.getContractFactory("EurocDepositIndex");
    let initDepositTx = await depositIndexFactory.attach(resultDepositIndexTUP.address).initialize(
        eurocPoolTUPAddress,
        { gasLimit: 8000000 }
    );
    await initDepositTx.wait();
    console.log(`EurocDepositIndex initialized with pool: ${eurocPoolTUPAddress}`);

    deployedContracts.push(
        {
            name: "EurocBorrowIndex",
            address: resultBorrowIndex.address,
            contractPath: "contracts/deployment/avalanche/EurocBorrowIndex.sol:EurocBorrowIndex",
            constructorArguments: [],
        },
        {
            name: "EurocBorrowIndexTUP",
            address: resultBorrowIndexTUP.address,
            contractPath: "contracts/proxies/tup/avalanche/EurocBorrowIndexTUP.sol:EurocBorrowIndexTUP",
            constructorArguments: [resultBorrowIndex.address, TIMELOCK_ADMIN, []],
        },
        {
            name: "EurocDepositIndex",
            address: resultDepositIndex.address,
            contractPath: "contracts/deployment/avalanche/EurocDepositIndex.sol:EurocDepositIndex",
            constructorArguments: [],
        },
        {
            name: "EurocDepositIndexTUP",
            address: resultDepositIndexTUP.address,
            contractPath: "contracts/proxies/tup/avalanche/EurocDepositIndexTUP.sol:EurocDepositIndexTUP",
            constructorArguments: [resultDepositIndex.address, TIMELOCK_ADMIN, []],
        }
    );

    // --- Deploy rates calculator ---
    console.log("\nDeploying EurocVariableUtilisationRatesCalculator...");
    const resultRates = await deploy("EurocVariableUtilisationRatesCalculator", {
        from: deployer,
        gasLimit: 8000000,
        args: [],
    });

    deployedContracts.push({
        name: "EurocVariableUtilisationRatesCalculator",
        address: resultRates.address,
        contractPath: "contracts/deployment/avalanche/EurocVariableUtilisationRatesCalculator.sol:EurocVariableUtilisationRatesCalculator",
        constructorArguments: [],
    });

    console.log(`EurocVariableUtilisationRatesCalculator deployed at address: ${resultRates.address}`);

    // --- Initialize pool (inlined) ---
    console.log("\nInitializing EUROC pool...");

    const poolFactory = await ethers.getContractFactory("Pool");
    const poolInstance = poolFactory.attach(eurocPoolTUPAddress);

    const smartLoansFactoryTUPDeployment = await get("SmartLoansFactoryTUP");

    let initPoolTx = await poolInstance.initialize(
        resultRates.address,
        smartLoansFactoryTUPDeployment.address,
        resultDepositIndexTUP.address,
        resultBorrowIndexTUP.address,
        TOKEN_ADDRESSES["EUROC"],
        ZERO_ADDRESS,
        0,
        { gasLimit: 8000000 }
    );
    await initPoolTx.wait();

    console.log(`Initialized EUROC pool with: [ratesCalculator: ${resultRates.address}, ` +
        `borrowersRegistry: ${smartLoansFactoryTUPDeployment.address}, depositIndex: ${resultDepositIndexTUP.address}, ` +
        `borrowIndex: ${resultBorrowIndexTUP.address}]. tokenAddress: ${TOKEN_ADDRESSES["EUROC"]}`);

    // --- Transfer ownership to multisig ---

    // Pool: 2-step transfer (PendingOwnableUpgradeable) — propose transfer, multisig must acceptOwnership()
    console.log(`\nProposing pool ownership transfer to multisig ${OWNER_MULTISIG}...`);
    const transferPoolTx = await poolInstance.transferOwnership(OWNER_MULTISIG, { gasLimit: 8000000 });
    await transferPoolTx.wait();
    console.log(`Pool ownership transfer proposed (tx: ${transferPoolTx.hash})`);

    // RatesCalculator: single-step transfer (Ownable)
    const ratesCalcFactory = await ethers.getContractFactory("EurocVariableUtilisationRatesCalculator");
    const ratesCalcInstance = ratesCalcFactory.attach(resultRates.address);
    console.log(`\nTransferring rates calculator ownership to multisig ${OWNER_MULTISIG}...`);
    const transferRatesTx = await ratesCalcInstance.transferOwnership(OWNER_MULTISIG, { gasLimit: 8000000 });
    await transferRatesTx.wait();
    console.log(`Rates calculator ownership transferred (tx: ${transferRatesTx.hash})`);

    // --- Gnosis Safe multisig transactions ---
    console.log("\n========================================");
    console.log("=== GNOSIS SAFE MULTISIG TRANSACTIONS ===");
    console.log("========================================");

    const tokenManagerTUPDeployment = await get("TokenManagerTUP");
    const tokenManagerInterface = new ethers.utils.Interface([
        "function addPoolAssets(tuple(bytes32 asset, address poolAddress)[] poolAssets)"
    ]);
    const poolAbiInterface = new ethers.utils.Interface([
        "function acceptOwnership()"
    ]);

    const eurocAssetBytes32 = toBytes32("EUROC");

    const addPoolCalldata = tokenManagerInterface.encodeFunctionData("addPoolAssets", [
        [{ asset: eurocAssetBytes32, poolAddress: eurocPoolTUPAddress }]
    ]);
    const acceptOwnershipCalldata = poolAbiInterface.encodeFunctionData("acceptOwnership", []);

    console.log("\n--- Transaction 1: Accept pool ownership ---");
    console.log("To (EurocPoolTUP):", eurocPoolTUPAddress);
    console.log("Function: acceptOwnership()");
    console.log("Calldata:", acceptOwnershipCalldata);
    console.log("Value: 0");

    console.log("\n--- Transaction 2: Register pool in TokenManager ---");
    console.log("To (TokenManagerTUP):", tokenManagerTUPDeployment.address);
    console.log("Function: addPoolAssets(poolAsset[])");
    console.log("Parameters:");
    console.log(`  - asset (bytes32): ${eurocAssetBytes32} (EUROC)`);
    console.log(`  - poolAddress: ${eurocPoolTUPAddress} (EurocPoolTUP)`);
    console.log("Calldata:", addPoolCalldata);
    console.log("Value: 0");

    console.log("\n========================================");
    console.log("=== END GNOSIS SAFE TRANSACTIONS ===");
    console.log("========================================\n");

    // --- Verification ---
    console.log("\nWaiting 5 seconds before verification...");
    await new Promise((resolve) => setTimeout(resolve, 5000));

    for (const contract of deployedContracts) {
        console.log(`\nVerifying ${contract.name}...`);

        try {
            await verifyContract(hre, {
                address: contract.address,
                contract: contract.contractPath,
                constructorArguments: contract.constructorArguments,
            });
            console.log(`Verified ${contract.name}`);
        } catch (error) {
            console.error(`Failed to verify ${contract.name}:`, error.message);
        }

        // Tenderly verification
        try {
            console.log(`Tenderly verification of ${contract.name} at:`, contract.address);
            await tenderly.verify({
                address: contract.address,
                name: contract.contractPath,
            });
            console.log(`Tenderly verified ${contract.name}`);
        } catch (error) {
            console.error(`Failed Tenderly verification for ${contract.name}:`, error.message);
        }
    }

    // --- Summary ---
    console.log("\n=== Deployment Summary ===");
    deployedContracts.forEach((contract) => {
        console.log(`${contract.name}: ${contract.address}`);
    });

    console.log("\n=== EUROC Pool Summary ===");
    console.log("Pool, indices, rates calculator deployed and initialized.");
    console.log(`TUP admin: ${TIMELOCK_ADMIN} (timelock)`);
    console.log(`Rates calculator ownership: transferred to ${OWNER_MULTISIG}`);
    console.log(`Pool ownership: proposed transfer to ${OWNER_MULTISIG} — requires acceptOwnership() via Gnosis Safe`);
    console.log("IMPORTANT: Execute the 2 Gnosis Safe transactions above to complete setup.");
};

module.exports.tags = ["euroc-pool-avalanche"];
