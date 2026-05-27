import { embedCommitHash } from "../../tools/scripts/embed-commit-hash";
const web3Abi  = require('web3-eth-abi');
const { ethers } = require("hardhat");
import verifyContract from "../../tools/scripts/verify-contract";
import hre from "hardhat";
const { tenderly } = require("hardhat");

module.exports = async ({ getNamedAccounts, deployments }) => {
    const { deploy } = deployments;
    const { deployer, admin } = await getNamedAccounts();

    embedCommitHash("GlvFacetArbitrum", "./contracts/facets/arbitrum");

    let GlvFacetArbitrum = await deploy("GlvFacetArbitrum", {
        from: deployer,
        args: [],
    });

    console.log(
        `GlvFacetArbitrum implementation deployed at address: ${GlvFacetArbitrum.address}`
    );

    // sleep for 10 seconds to wait for the tx to be confirmed
    await new Promise(r => setTimeout(r, 10000));

    // Regular contract verification
    try {
        await verifyContract(hre, {
            address: GlvFacetArbitrum.address,
            contract: `contracts/facets/arbitrum/GlvFacetArbitrum.sol:GlvFacetArbitrum`,
            constructorArguments: []
        });
        console.log(`✅ Verified GlvFacetArbitrum`);
    } catch (error) {
        console.error(`❌ Failed to verify GlvFacetArbitrum:`, error.message);
    }

    // Tenderly verification
    try {
        console.log(`Tenderly verification of GlvFacetArbitrum at:`, GlvFacetArbitrum.address);
        await tenderly.verify({
            address: GlvFacetArbitrum.address,
            name: `contracts/facets/arbitrum/GlvFacetArbitrum.sol:GlvFacetArbitrum`,
        });
        console.log(`✅ Tenderly verified GlvFacetArbitrum`);
    } catch (error) {
        console.error(`❌ Failed Tenderly verification for GlvFacetArbitrum:`, error.message);
    }
};

module.exports.tags = ["arbi-glv"];