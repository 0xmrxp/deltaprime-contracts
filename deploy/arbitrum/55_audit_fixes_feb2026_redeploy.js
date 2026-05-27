import { embedCommitHash } from "../../tools/scripts/embed-commit-hash";
import hre from "hardhat";
const { tenderly } = require("hardhat");
const { verifyDeployment, writeManifest } = require("../../tools/scripts/verify-from-deployment");

const SLEEP_AFTER_DEPLOY_MS = 10000;
const VERIFY_TIMEOUT_MS = 180000; // 3 min hard cap per Tenderly call
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// tenderly.verify can hang indefinitely on a transient API stall. Wrap it in a
// timeout race so a single hung call cannot block the rest of the deploy.
// (Block-explorer verification has its own retry/timeout logic in
// verify-from-deployment.js.)
const withTimeout = (promise, ms, label) =>
    Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms)),
    ]);

/**
 * I-01 (audit-review note): YALLA flagged the `unwindUnsupportedTraderJoeV2Position`
 * selector as a potential orphan that a diamondCut migration must explicitly Remove
 * since a plain `Replace` won't drop it. Verification on the audit-fixes-feb2026 branch:
 *   - The function does not exist in this branch's source (`grep` returns no hits).
 *   - The deployed `TraderJoeV2ArbitrumFacet` artifact on this branch does not expose
 *     the selector either.
 *   - No `TraderJoeV2*Facet` is in the TARGETS list below — this redeploy does not
 *     touch any TraderJoe facet, so whatever selector set those facets currently expose
 *     on-chain (including any historically-added `unwindUnsupportedTraderJoeV2Position`
 *     from the feature/unwind-unsupported-tjv2 branch) is preserved unchanged.
 *   No diamondCut Remove is required for this redeploy. The orphan-selector concern
 *   would only re-emerge if a future deploy script DOES touch the TraderJoe facets
 *   with a source variant that omits the function — at that point an explicit Remove
 *   would be needed.
 *
 * Deploys every implementation that PR #108 (audit-fixes-feb2026) touches
 * for the Arbitrum deployment, then writes a verify manifest and runs
 * block-explorer (Etherscan v2) + Tenderly verification for each one.
 *
 * Scope (all source-changed in audit-fixes-feb2026 vs main, plus inheritors
 * of changed abstract bases / libraries that need a fresh build):
 *   Facets (replace via diamondCut on SmartLoanDiamondBeacon):
 *     - AssetsOperationsArbitrumFacet      (M-06, M-12)
 *     - GlvFacetArbitrum                   (M-05, inherits GmxV2FeesHelper M-12/M-17)
 *     - GmxV2FacetArbitrum                 (M-05, inherits GmxV2FeesHelper)
 *     - GmxV2PlusFacetArbitrum             (M-05 follow-up, inherits GmxV2FeesHelper)
 *     - GmxV2CallbacksFacetArbitrum        (inherits GmxV2FeesHelper - M-12/M-17)
 *     - SolvencyFacetProdArbitrum          (DPSC-340)
 *     - PrimeLeverageFacet                 (C-01, M-06, M-09, M-18, L-02, L-03, DPSC-257)
 *     - SmartLoanLiquidationFacet          (M-01 revert, M-02, M-04, M-08; uses M-04 storage fields)
 *     - SmartLoanViewFacet                 (inherits GmxV2FeesHelper)
 *     - SmartLoanWrappedNativeTokenFacet   (M-06)
 *     - WithdrawalIntentFacet              (M-03, M-18 follow-up, L-04)
 *     - ParaSwapFacet                      (M-04 follow-up via ParaSwapHelper)
 *
 *   TUP-proxied (deploy new impl; SmartLoansFactoryTUP `upgradeTo` is a separate multisig step):
 *     - SmartLoansFactory                  (M-15)
 *
 * The script does NOT execute the diamondCut Replace calls or the TUP
 * upgradeTo - those are signed off-chain by the protocol multisig.
 * The summary log at the end provides the addresses to feed into those txs.
 *
 * Verification is decoupled: the deploy writes deployments/arbitrum/
 * audit-fixes-feb2026.verify-manifest.json, and verification can be re-run any
 * time (idempotently) with:
 *   npx hardhat run tools/scripts/verify-deployments.js --network arbitrum
 */
// Facets whose bytecode carries an unresolved GmxBenchmarkMath placeholder. The
// library address must be linked in at deploy time (hardhat-deploy `libraries`
// option) and passed to Tenderly verification. Block-explorer verification reads
// the link straight from the deployment artifact, so it does NOT consult this set.
//
// Membership is derived from each artifact's `linkReferences` in the compiled output:
//   - AssetsOperationsArbitrumFacet: calls GmxBenchmarkMath.premiumScaledUnderlying.
//   - SolvencyFacetProdArbitrum:     calls GmxBenchmarkMath.deductibleFeeInGmTokens.
//   - SmartLoanViewFacet:            reaches the library through
//                                    GmxV2FeesHelper._getDeductibleFeesInGmTokens.
// Other GmxV2FeesHelper inheritors (GmxV2*Facet, GlvFacet) do NOT appear here — they
// never reach that internal function, so solc dead-code-eliminates it and emits no
// placeholder.
const NEEDS_GMX_BENCHMARK_MATH = new Set([
    "AssetsOperationsArbitrumFacet",
    "SolvencyFacetProdArbitrum",
    "SmartLoanViewFacet",
]);

const TARGETS = [
    // TUP implementation
    { name: "SmartLoansFactory",            embedDir: undefined,                          contract: "contracts/SmartLoansFactory.sol:SmartLoansFactory" },

    // // Arbitrum-specific facets
    // { name: "AssetsOperationsArbitrumFacet",  embedDir: "./contracts/facets/arbitrum",  contract: "contracts/facets/arbitrum/AssetsOperationsArbitrumFacet.sol:AssetsOperationsArbitrumFacet" },
    // { name: "GlvFacetArbitrum",               embedDir: "./contracts/facets/arbitrum",  contract: "contracts/facets/arbitrum/GlvFacetArbitrum.sol:GlvFacetArbitrum" },
    // { name: "GmxV2FacetArbitrum",             embedDir: "./contracts/facets/arbitrum",  contract: "contracts/facets/arbitrum/GmxV2FacetArbitrum.sol:GmxV2FacetArbitrum" },
    // { name: "GmxV2PlusFacetArbitrum",         embedDir: "./contracts/facets/arbitrum",  contract: "contracts/facets/arbitrum/GmxV2PlusFacetArbitrum.sol:GmxV2PlusFacetArbitrum" },
    // { name: "GmxV2CallbacksFacetArbitrum",    embedDir: "./contracts/facets/arbitrum",  contract: "contracts/facets/arbitrum/GmxV2CallbacksFacetArbitrum.sol:GmxV2CallbacksFacetArbitrum" },
    // { name: "SolvencyFacetProdArbitrum",      embedDir: "./contracts/facets/arbitrum",  contract: "contracts/facets/arbitrum/SolvencyFacetProdArbitrum.sol:SolvencyFacetProdArbitrum" },

    // // Shared facets
    // { name: "PrimeLeverageFacet",             embedDir: "./contracts/facets",           contract: "contracts/facets/PrimeLeverageFacet.sol:PrimeLeverageFacet" },
    // { name: "SmartLoanLiquidationFacet",      embedDir: "./contracts/facets",           contract: "contracts/facets/SmartLoanLiquidationFacet.sol:SmartLoanLiquidationFacet" },
    // { name: "SmartLoanViewFacet",             embedDir: "./contracts/facets",           contract: "contracts/facets/SmartLoanViewFacet.sol:SmartLoanViewFacet" },
    // { name: "SmartLoanWrappedNativeTokenFacet", embedDir: "./contracts/facets",         contract: "contracts/facets/SmartLoanWrappedNativeTokenFacet.sol:SmartLoanWrappedNativeTokenFacet" },
    // { name: "WithdrawalIntentFacet",          embedDir: "./contracts/facets",           contract: "contracts/facets/WithdrawalIntentFacet.sol:WithdrawalIntentFacet" },
    // { name: "ParaSwapFacet",                  embedDir: "./contracts/facets",           contract: "contracts/facets/ParaSwapFacet.sol:ParaSwapFacet" },
];

// GmxBenchmarkMath (DELEGATECALL library) is deployed first and verified alongside
// the facets. It is not in TARGETS because it has no embedCommitHash stamp.
const GMX_BENCHMARK_MATH_CONTRACT = "contracts/lib/GmxBenchmarkMath.sol:GmxBenchmarkMath";

module.exports = async ({ getNamedAccounts, deployments }) => {
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();

    console.log("== Arbitrum audit-fixes-feb2026 redeploy ==");
    console.log(`Deployer: ${deployer}`);
    console.log(`Targets:  ${TARGETS.length}`);

    // Stamp current commit hash into every target's source file.
    // embedCommitHash also triggers `npx hardhat compile` after each rewrite;
    // doing this up-front means every deploy() call below sees a consistent build.
    for (const t of TARGETS) {
        if (t.embedDir) {
            embedCommitHash(t.name, t.embedDir);
        } else {
            embedCommitHash(t.name);
        }
    }

    // TEMP (only-SmartLoansFactory deploy): GmxBenchmarkMath deploy disabled.
    // SmartLoansFactory is not in NEEDS_GMX_BENCHMARK_MATH, so the library is
    // not needed here. Restore this block when redeploying the GMX-linked facets.
    // console.log("\n--- deploy GmxBenchmarkMath (library) ---");
    // const gmxBenchmarkMath = await deploy("GmxBenchmarkMath", {
    //     from: deployer,
    //     args: [],
    // });
    // console.log(`Deployed at: ${gmxBenchmarkMath.address} (newlyDeployed=${gmxBenchmarkMath.newlyDeployed})`);

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
    // TEMP: GmxBenchmarkMath excluded from verification (not deployed).
    const allNames = [...TARGETS.map((t) => t.name)];
    const manifestFile = writeManifest(hre, "audit-fixes-feb2026", allNames);
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
        // TEMP: GmxBenchmarkMath excluded (not deployed).
        // { name: "GmxBenchmarkMath", contract: GMX_BENCHMARK_MATH_CONTRACT },
        ...TARGETS,
    ];
    for (const t of tenderlyTargets) {
        try {
            const args = { address: deployedAddrs[t.name], name: t.contract };
            if (NEEDS_GMX_BENCHMARK_MATH.has(t.name)) {
                args.libraries = { GmxBenchmarkMath: gmxBenchmarkMath.address };
            }
            await withTimeout(tenderly.verify(args), VERIFY_TIMEOUT_MS, `Tenderly verify ${t.name}`);
            console.log(`✅ Tenderly verified ${t.name}`);
        } catch (error) {
            console.error(`❌ Tenderly verification failed for ${t.name}: ${error.message}`);
        }
    }

    console.log("\n== Deploy summary (Arbitrum) ==");
    for (const [name, addr] of Object.entries(deployedAddrs)) {
        console.log(`${name.padEnd(38)} ${addr}`);
    }

    const failed = verifyResults.filter((r) => !r.ok).map((r) => r.name);
    if (failed.length > 0) {
        console.log(`\n⚠️  Block-explorer verification failed for: ${failed.join(", ")}`);
        console.log("   Re-run (idempotent): npx hardhat run tools/scripts/verify-deployments.js --network arbitrum");
    }

    console.log("\nNext steps (multisig, not in this script):");
    console.log("  1. diamondCut Replace on SmartLoanDiamondBeacon for each facet listed above except SmartLoansFactory.");
    console.log("  2. SmartLoansFactoryTUP.upgradeTo(<new SmartLoansFactory address>).");
};

module.exports.tags = ["arbitrum-audit-fixes-feb2026"];
