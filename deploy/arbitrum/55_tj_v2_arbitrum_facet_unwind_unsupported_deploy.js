import { embedCommitHash } from "../../tools/scripts/embed-commit-hash";
import verifyContract from "../../tools/scripts/verify-contract";
import hre from "hardhat";
const { ethers, tenderly } = require("hardhat");

// Redeploys TraderJoeV2ArbitrumFacet with the added unwindUnsupportedTraderJoeV2Position
// method. The deployed implementation must subsequently be wired into the
// SmartLoanDiamondBeacon via a diamond cut (multisig step).
module.exports = async ({ getNamedAccounts, deployments }) => {
    const { deploy } = deployments;
    const { deployer, admin } = await getNamedAccounts();

    embedCommitHash("TraderJoeV2ArbitrumFacet", "./contracts/facets/arbitrum");

    const contractsToDeploy = [
        {
            name: "TraderJoeV2ArbitrumFacet",
            contractPath: "contracts/facets/arbitrum/TraderJoeV2ArbitrumFacet.sol:TraderJoeV2ArbitrumFacet",
            args: []
        }
    ];

    const deployedContracts = [];

    for (const contractConfig of contractsToDeploy) {
        console.log(`\nDeploying ${contractConfig.name}...`);

        let deployedContract = await deploy(contractConfig.name, {
            from: deployer,
            args: contractConfig.args,
            contract: contractConfig.contractPath
        });

        deployedContracts.push({
            name: contractConfig.name,
            address: deployedContract.address,
            contractPath: contractConfig.contractPath,
            constructorArguments: contractConfig.args
        });

        console.log(
            `${contractConfig.name} implementation deployed at address: ${deployedContract.address}`
        );
    }

    console.log("\nWaiting 10 seconds before verification...");
    await new Promise(resolve => setTimeout(resolve, 10000));

    for (const contract of deployedContracts) {
        console.log(`\nVerifying ${contract.name}...`);

        try {
            await verifyContract(hre, {
                address: contract.address,
                contract: contract.contractPath,
                constructorArguments: contract.constructorArguments
            });
            console.log(`✅ Verified ${contract.name}`);
        } catch (error) {
            console.error(`❌ Failed to verify ${contract.name}:`, error.message);
        }

        try {
            console.log(`Tenderly verification of ${contract.name} at:`, contract.address);
            await tenderly.verify({
                address: contract.address,
                name: contract.contractPath,
            });
            console.log(`✅ Tenderly verified ${contract.name}`);
        } catch (error) {
            console.error(`❌ Failed Tenderly verification for ${contract.name}:`, error.message);
        }
    }

    console.log("\n=== Deployment Summary ===");
    deployedContracts.forEach(contract => {
        console.log(`${contract.name}: ${contract.address}`);
    });
};

module.exports.tags = ["arbitrum-tjv2-unwind-unsupported"];
