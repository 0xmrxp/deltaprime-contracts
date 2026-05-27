import { embedCommitHash } from "../../tools/scripts/embed-commit-hash";
import verifyContract from "../../tools/scripts/verify-contract";
import hre from "hardhat";
import path from 'path';
const { tenderly } = require("hardhat");

module.exports = async ({ getNamedAccounts, deployments }) => {
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();

    // Configuration for the 5 contracts extracted from the first script
    const facetsToDeploy = [
        { 
            name: "GlvFacetArbitrum", 
            source: "contracts/facets/arbitrum/GlvFacetArbitrum.sol",
            dir: "./contracts/facets/arbitrum"
        },
        { 
            name: "AssetsOperationsArbitrumFacet", 
            source: "contracts/facets/arbitrum/AssetsOperationsArbitrumFacet.sol",
            dir: "./contracts/facets/arbitrum"
        },
        { 
            name: "GmxV2CallbacksFacetArbitrum", 
            source: "contracts/facets/arbitrum/GmxV2CallbacksFacetArbitrum.sol",
            dir: "./contracts/facets/arbitrum"
        },
        { 
            name: "SolvencyFacetProdArbitrum", 
            source: "contracts/facets/arbitrum/SolvencyFacetProdArbitrum.sol",
            dir: "./contracts/facets/arbitrum"
        },
        { 
            name: "WithdrawalIntentFacet", 
            source: "contracts/facets/WithdrawalIntentFacet.sol",
            dir: "./contracts/facets"
        }
    ];

    console.log(`\n🚀 Starting deployment of ${facetsToDeploy.length} facets...\n`);

    for (const facet of facetsToDeploy) {
        console.log(`--- Processing ${facet.name} ---`);

        // 1. Embed Commit Hash
        // We look for the directory containing the file
        try {
            embedCommitHash(facet.name, facet.dir);
        } catch (e) {
            console.log(`⚠️  Could not embed commit hash for ${facet.name} (check directory path)`);
        }

        // 2. Deploy
        const deploymentResult = await deploy(facet.name, {
            from: deployer,
            args: [], // Assuming no constructor arguments as per your reference
            log: true,
        });

        console.log(`📄 ${facet.name} deployed at: ${deploymentResult.address}`);

        // Only sleep and verify if it was a new deployment
        if (deploymentResult.newlyDeployed) {
            console.log(`⏳ Waiting 10 seconds for confirmations...`);
            await new Promise(r => setTimeout(r, 10000));

            // 3. Regular Contract Verification
            try {
                await verifyContract(hre, {
                    address: deploymentResult.address,
                    contract: `${facet.source}:${facet.name}`,
                    constructorArguments: []
                });
                console.log(`✅ Verified ${facet.name} on block explorer`);
            } catch (error) {
                console.error(`❌ Failed to verify ${facet.name}:`, error.message);
            }

            // 4. Tenderly Verification
            try {
                console.log(`Using Tenderly to verify ${facet.name}...`);
                await tenderly.verify({
                    address: deploymentResult.address,
                    name: `${facet.source}:${facet.name}`,
                });
                console.log(`✅ Tenderly verified ${facet.name}`);
            } catch (error) {
                console.error(`❌ Failed Tenderly verification for ${facet.name}:`, error.message);
            }
        } else {
            console.log(`ℹ️  Contract already deployed, skipping verification wait time.`);
        }
        
        console.log(""); // Empty line for readability
    }

    console.log(`\n🎉 All requested facets have been processed.`);
};

module.exports.tags = ["glv-facets-arbi"];