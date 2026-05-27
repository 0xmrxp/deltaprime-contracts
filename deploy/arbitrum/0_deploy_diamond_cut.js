import { embedCommitHash } from "../../tools/scripts/embed-commit-hash";
import verifyContract from "../../tools/scripts/verify-contract";
import hre from "hardhat";
const { tenderly } = require("hardhat");

module.exports = async ({ getNamedAccounts, deployments }) => {
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();

    // Embed commit hash for DiamondCutFacet
    embedCommitHash("facets/DiamondCutFacet");

    // Deploy DiamondCutFacet
    console.log("\nDeploying DiamondCutFacet...");
    const diamondCutFacet = await deploy("DiamondCutFacet", {
        from: deployer,
        args: []
    });

    console.log(`DiamondCutFacet deployed: ${diamondCutFacet.address}`);

    // Sleep 5 seconds before verification
    console.log("\nWaiting 5 seconds before verification...");
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Verify on block explorer
    console.log(`\nVerifying DiamondCutFacet on block explorer...`);
    try {
        await verifyContract(hre, {
            address: diamondCutFacet.address,
            contract: "contracts/facets/DiamondCutFacet.sol:DiamondCutFacet",
            constructorArguments: []
        });
        console.log(`✅ Verified DiamondCutFacet`);
    } catch (error) {
        console.error(`❌ Failed to verify DiamondCutFacet:`, error.message);
    }

    // Tenderly verification
    try {
        console.log(`\nTenderly verification of DiamondCutFacet at:`, diamondCutFacet.address);
        await tenderly.verify({
            address: diamondCutFacet.address,
            name: "contracts/facets/DiamondCutFacet.sol:DiamondCutFacet",
        });
        console.log(`✅ Tenderly verified DiamondCutFacet`);
    } catch (error) {
        console.error(`❌ Failed Tenderly verification for DiamondCutFacet:`, error.message);
    }

    console.log("\n=== Deployment Summary ===");
    console.log(`DiamondCutFacet: ${diamondCutFacet.address}`);
};

module.exports.tags = ["diamond-cut-facet"];