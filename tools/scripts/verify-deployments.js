/**
 * verify-deployments.js
 *
 * Standalone, re-runnable block-explorer verification for a deployment batch.
 * Reads every *.verify-manifest.json under deployments/<network>/ (written by the
 * deploy scripts) and verifies each listed contract via verify-from-deployment.js
 * — which submits the exact saved solc input, so this works regardless of any
 * working-tree changes since the deploy.
 *
 * Usage:
 *   npx hardhat run tools/scripts/verify-deployments.js --network avalanche
 *   npx hardhat run tools/scripts/verify-deployments.js --network arbitrum
 *
 * Verification is idempotent — already-verified contracts are reported ok and
 * skipped, so this is safe to re-run until everything passes.
 */

const hre = require("hardhat");
const { verifyAllManifests } = require("./verify-from-deployment");

(async () => {
    console.log(`== verify-deployments (${hre.network.name}) ==`);
    const { allOk } = await verifyAllManifests(hre);
    if (!allOk) {
        console.log("\nSome contracts failed verification — re-run this script to retry the failures.");
        process.exit(1);
    }
    console.log("\nAll contracts verified.");
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
