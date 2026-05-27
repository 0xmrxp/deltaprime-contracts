import { embedCommitHash } from "../../tools/scripts/embed-commit-hash";
import hre from "hardhat";
const { tenderly } = require("hardhat");
const { verifyDeployment, writeManifest } = require("../../tools/scripts/verify-from-deployment");

const SLEEP_AFTER_DEPLOY_MS = 10000;
const VERIFY_TIMEOUT_MS = 180000; // 3 min hard cap per Tenderly call
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// tenderly.verify can hang indefinitely on a transient API stall. Wrap it in a
// timeout race so a single hung call cannot block the rest of the deploy.
const withTimeout = (promise, ms, label) =>
    Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms)),
    ]);

/**
 * RedStone node migration (branch: feat/migrate-rs-nodes) — Arbitrum redeploy.
 *
 * RedStone is decommissioning the per-chain "redstone-arbitrum-prod" /
 * "redstone-avalanche-prod" data services it had stood up specifically for
 * DeltaPrime, and consolidating DeltaPrime onto its shared primary node
 * ("redstone-primary-prod"). This redeploy ships the contract side of that move.
 *
 * Source changes carried by this redeploy:
 *   - SolvencyFacetProd (abstract base) now extends
 *     PrimaryProdDataServiceConsumerBase instead of the generic
 *     RedstoneConsumerNumericBase, so it carries the redstone-primary-prod data
 *     service id, signer set and unique-signers threshold.
 *   - SolvencyFacetProdArbitrum dropped its per-chain getDataServiceId /
 *     getUniqueSignersThreshold / getAuthorisedSignerIndex overrides — it now
 *     inherits the primary-node config from the base.
 *   - HealthMeterFacetProd now extends PrimaryProdDataServiceConsumerBase
 *     instead of ArbitrumProdDataServiceConsumerBase.
 *   - @redstone-finance/evm-connector bumped 0.2.5 -> 0.9.0, which rebuilds the
 *     RedStone consumer-base bytecode underneath every facet here.
 *
 * UniswapV3Facet was also migrated in source but is NOT redeployed here: it has
 * never been deployed on a DeltaPrime chain and is not registered in any Diamond.
 *
 * Scope (replace via diamondCut on SmartLoanDiamondBeacon):
 *   - SolvencyFacetProdArbitrum
 *   - HealthMeterFacetProd
 *
 * The script does NOT execute the diamondCut Replace calls — those are signed
 * off-chain by the protocol multisig. The summary log at the end provides the
 * addresses to feed into those txs.
 *
 * Verification is decoupled: the deploy writes
 * deployments/arbitrum/rs-node-migration.verify-manifest.json, and verification
 * can be re-run any time (idempotently) with:
 *   npx hardhat run tools/scripts/verify-deployments.js --network arbitrum
 */

// SolvencyFacetProdArbitrum's bytecode carries an unresolved GmxBenchmarkMath
// placeholder (SolvencyFacetProd reaches GmxBenchmarkMath.deductibleFeeInGmTokens),
// so the library must be linked in at deploy time. HealthMeterFacetProd does not
// (its compiled linkReferences are empty).
const NEEDS_GMX_BENCHMARK_MATH = new Set([
    "SolvencyFacetProdArbitrum",
]);

const TARGETS = [
    { name: "SolvencyFacetProdArbitrum", embedDir: "./contracts/facets/arbitrum", contract: "contracts/facets/arbitrum/SolvencyFacetProdArbitrum.sol:SolvencyFacetProdArbitrum" },
    { name: "HealthMeterFacetProd",      embedDir: "./contracts/facets",          contract: "contracts/facets/HealthMeterFacetProd.sol:HealthMeterFacetProd" },
];

// GmxBenchmarkMath (DELEGATECALL library) is deployed first so its address can
// be linked into SolvencyFacetProdArbitrum. Its source is unchanged by this
// migration, so hardhat-deploy reuses the existing on-chain deployment when the
// bytecode matches (newlyDeployed=false).
const GMX_BENCHMARK_MATH_CONTRACT = "contracts/lib/GmxBenchmarkMath.sol:GmxBenchmarkMath";

module.exports = async ({ getNamedAccounts, deployments }) => {
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();

    console.log("== Arbitrum RedStone node migration redeploy ==");
    console.log(`Deployer: ${deployer}`);
    console.log(`Targets:  ${TARGETS.length}`);

    // Stamp current commit hash into every target's source file.
    // embedCommitHash also triggers `npx hardhat compile` after each rewrite;
    // doing this up-front means every deploy() call below sees a consistent build.
    for (const t of TARGETS) {
        embedCommitHash(t.name, t.embedDir);
    }

    // GmxBenchmarkMath — unchanged source, so hardhat-deploy reuses the existing
    // on-chain deployment when the bytecode matches (newlyDeployed=false).
    console.log("\n--- deploy GmxBenchmarkMath (library) ---");
    const gmxBenchmarkMath = await deploy("GmxBenchmarkMath", {
        from: deployer,
        args: [],
    });
    console.log(`Address: ${gmxBenchmarkMath.address} (newlyDeployed=${gmxBenchmarkMath.newlyDeployed})`);

    const deployedAddrs = {};

    // Deploy every target.
    for (const t of TARGETS) {
        console.log(`\n--- deploy ${t.name} ---`);
        const deployOpts = { from: deployer, args: [] };
        if (NEEDS_GMX_BENCHMARK_MATH.has(t.name)) {
            deployOpts.libraries = { GmxBenchmarkMath: gmxBenchmarkMath.address };
        }
        const result = await deploy(t.name, deployOpts);
        deployedAddrs[t.name] = result.address;
        console.log(`Deployed at: ${result.address} (newlyDeployed=${result.newlyDeployed})`);
    }

    // Write the verify manifest BEFORE verifying, so the whole batch can be
    // re-verified later even if verification below partially fails.
    const allNames = ["GmxBenchmarkMath", ...TARGETS.map((t) => t.name)];
    const manifestFile = writeManifest(hre, "rs-node-migration", allNames);
    console.log(`\nWrote verify manifest: ${manifestFile}`);

    // Give the explorer a moment to index the freshly-deployed bytecode.
    await sleep(SLEEP_AFTER_DEPLOY_MS);

    // Block-explorer (Etherscan v2) verification. verifyDeployment submits the
    // exact saved solc input as a minimal closure and reads any library link
    // from the deployment artifact — immune to working-tree drift and solc-wasm OOM.
    console.log("\n== Block-explorer verification ==");
    const verifyResults = [];
    for (const name of allNames) {
        const r = await verifyDeployment(hre, name);
        console.log(`${r.ok ? "✅" : "❌"} ${name}: ${r.detail}`);
        verifyResults.push(r);
    }

    // Tenderly verification (separate dashboard; reads working-tree artifacts).
    console.log("\n== Tenderly verification ==");
    const tenderlyTargets = [
        { name: "GmxBenchmarkMath", contract: GMX_BENCHMARK_MATH_CONTRACT, address: gmxBenchmarkMath.address },
        ...TARGETS.map((t) => ({ ...t, address: deployedAddrs[t.name] })),
    ];
    for (const t of tenderlyTargets) {
        try {
            const args = { address: t.address, name: t.contract };
            if (NEEDS_GMX_BENCHMARK_MATH.has(t.name)) {
                args.libraries = { GmxBenchmarkMath: gmxBenchmarkMath.address };
            }
            await withTimeout(tenderly.verify(args), VERIFY_TIMEOUT_MS, `Tenderly verify ${t.name}`);
            console.log(`✅ Tenderly verified ${t.name}`);
        } catch (error) {
            console.error(`❌ Tenderly verification failed for ${t.name}: ${error.message}`);
        }
    }

    console.log("\n== Deploy summary (Arbitrum RedStone node migration) ==");
    console.log(`${"GmxBenchmarkMath".padEnd(28)} ${gmxBenchmarkMath.address}`);
    for (const [name, addr] of Object.entries(deployedAddrs)) {
        console.log(`${name.padEnd(28)} ${addr}`);
    }

    const failed = verifyResults.filter((r) => !r.ok).map((r) => r.name);
    if (failed.length > 0) {
        console.log(`\n⚠️  Block-explorer verification failed for: ${failed.join(", ")}`);
        console.log("   Re-run (idempotent): npx hardhat run tools/scripts/verify-deployments.js --network arbitrum");
    }

    console.log("\nNext steps (protocol multisig, NOT in this script):");
    console.log("  1. diamondCut Replace on SmartLoanDiamondBeacon for each facet above");
    console.log("     (except GmxBenchmarkMath) pointing its selectors at the new address.");
    console.log("  2. Switch the client-side RedStone data-service-id from");
    console.log("     redstone-arbitrum-prod to redstone-primary-prod together with step 1.");
};

module.exports.tags = ["arbitrum-rs-node-migration"];
