import { embedCommitHash } from "../../tools/scripts/embed-commit-hash";
import verifyContract from "../../tools/scripts/verify-contract";
import hre from "hardhat";

const { ethers } = require("hardhat");

const OWNER_MULTISIG = "0x44AfCcF712E8A097a6727B48b57c75d7A85a9B0c";
const CACHE_BATCH_SIZE = 250;

module.exports = async ({ getNamedAccounts, deployments }) => {
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();

    embedCommitHash("ReusablePrimeDistributor", "./contracts");

    // Avalanche addresses
    const primeToken = "0x33C8036E99082B0C395374832FECF70c42C7F298";
    const rTKNConverter = "0x6632409698454E3FAE685Eaa4d6fdC5b6e9b7716";

    // Per-instance cap derived from converter's totalrTKNPledged × CONVERSION_RATIO.
    // initialDistributed = sum of totalPrimeDistributed across all prior single-use
    // PrimeRtknAirdropDistributor instances that served this converter (measured
    // on-chain via tools/scripts/analyze-rtkn-airdrops.js on 2026-04-15).
    const distributionCap = "1092746073618846988905507";     // 1,092,746.073619 PRIME
    const initialDistributed = "364248694146167646462904";   // 364,248.694146 PRIME

    // --- Deploy ---
    let distributor = await deploy("ReusablePrimeDistributor", {
        from: deployer,
        args: [primeToken, rTKNConverter, distributionCap, initialDistributed],
    });

    console.log(
        `ReusablePrimeDistributor deployed on Avalanche at address: ${distributor.address}`
    );

    // Give the explorer a moment to index before verification.
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Wrap verification in a timeout + try/catch: the explorer sometimes
    // accepts the source but never returns a final "verified" ack, hanging
    // the deploy indefinitely. We move on either way — if verification
    // didn't land, it can be done manually later without blocking init.
    const VERIFY_TIMEOUT_MS = 60000;
    try {
        await Promise.race([
            verifyContract(hre, {
                address: distributor.address,
                contract: `contracts/ReusablePrimeDistributor.sol:ReusablePrimeDistributor`,
                constructorArguments: [primeToken, rTKNConverter, distributionCap, initialDistributed],
            }),
            new Promise((_, reject) =>
                setTimeout(
                    () => reject(new Error(`verification poll timeout (${VERIFY_TIMEOUT_MS}ms)`)),
                    VERIFY_TIMEOUT_MS
                )
            ),
        ]);
        console.log(`Verified ReusablePrimeDistributor on Avalanche`);
    } catch (e) {
        console.log(
            `Verification skipped/timed out — continuing: ${e.message}`
        );
    }

    // --- One-time initialization: cache users in batches until complete ---
    const distributorInstance = await ethers.getContractAt(
        "ReusablePrimeDistributor",
        distributor.address
    );

    let batch = 0;
    while (!(await distributorInstance.usersCached())) {
        batch++;
        const tx = await distributorInstance.cacheUsers(CACHE_BATCH_SIZE);
        await tx.wait();
        const [cached, total] = await distributorInstance.getCachingProgress();
        console.log(
            `cacheUsers batch ${batch}: ${cached.toString()}/${total.toString()} (tx: ${tx.hash})`
        );
    }

    const totalCached = await distributorInstance.getTotalCachedUsers();
    const totalShares = await distributorInstance.totalShares();
    console.log(
        `Caching complete — ${totalCached.toString()} users with ${totalShares.toString()} total shares`
    );

    // --- Transfer ownership to multisig ---
    console.log(`\nTransferring ownership to multisig ${OWNER_MULTISIG}...`);
    const transferTx = await distributorInstance.transferOwnership(OWNER_MULTISIG);
    await transferTx.wait();
    console.log(`Ownership transferred (tx: ${transferTx.hash})`);

    const newOwner = await distributorInstance.owner();
    if (newOwner.toLowerCase() !== OWNER_MULTISIG.toLowerCase()) {
        throw new Error(
            `Ownership transfer verification failed: owner is ${newOwner}, expected ${OWNER_MULTISIG}`
        );
    }
    console.log(`Verified new owner: ${newOwner}`);
};

module.exports.tags = ["avalanche-reusable-prime-distributor"];
