import { embedCommitHash } from "../../tools/scripts/embed-commit-hash";
import verifyContract from "../../tools/scripts/verify-contract";
import hre from "hardhat";

const { ethers } = require("hardhat");

const OWNER_MULTISIG = "0xDfA6706FC583b635CD6daF0E3915901A2fBaBAaD";
const CACHE_BATCH_SIZE = 250;

async function deployAndInitialize({
    deploy,
    deployer,
    instanceLabel,
    deploymentName,
    primeToken,
    rTKNConverter,
    distributionCap,
    initialDistributed,
}) {
    const deployOpts = {
        from: deployer,
        args: [primeToken, rTKNConverter, distributionCap, initialDistributed],
    };
    if (deploymentName !== "ReusablePrimeDistributor") {
        deployOpts.contract = "ReusablePrimeDistributor";
    }

    const distributor = await deploy(deploymentName, deployOpts);
    console.log(
        `ReusablePrimeDistributor ${instanceLabel} deployed on Arbitrum at address: ${distributor.address}`
    );

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
        console.log(`Verified ReusablePrimeDistributor ${instanceLabel} on Arbitrum`);
    } catch (e) {
        console.log(
            `ReusablePrimeDistributor ${instanceLabel} verification skipped/timed out — continuing: ${e.message}`
        );
    }

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
            `${instanceLabel} cacheUsers batch ${batch}: ${cached.toString()}/${total.toString()} (tx: ${tx.hash})`
        );
    }

    const totalCached = await distributorInstance.getTotalCachedUsers();
    const totalShares = await distributorInstance.totalShares();
    console.log(
        `${instanceLabel} caching complete — ${totalCached.toString()} users with ${totalShares.toString()} total shares`
    );

    console.log(`\n${instanceLabel}: transferring ownership to multisig ${OWNER_MULTISIG}...`);
    const transferTx = await distributorInstance.transferOwnership(OWNER_MULTISIG);
    await transferTx.wait();
    console.log(`${instanceLabel} ownership transferred (tx: ${transferTx.hash})`);

    const newOwner = await distributorInstance.owner();
    if (newOwner.toLowerCase() !== OWNER_MULTISIG.toLowerCase()) {
        throw new Error(
            `${instanceLabel} ownership transfer verification failed: owner is ${newOwner}, expected ${OWNER_MULTISIG}`
        );
    }
    console.log(`${instanceLabel} verified new owner: ${newOwner}`);
}

module.exports = async ({ getNamedAccounts, deployments }) => {
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();

    embedCommitHash("ReusablePrimeDistributor", "./contracts");

    // Arbitrum addresses
    const primeToken = "0x3De81CE90f5A27C5E6A5aDb04b54ABA488a6d14E";
    const rTKNConverter1 = "0xAd2E3761f071026ed1619876937a0eeC5c3c98B4";
    const rTKNConverter2 = "0xC1E3efF128c090A434927B0ff779d555bB3F75E5";

    // Per-instance caps derived from each converter's totalrTKNPledged × CONVERSION_RATIO.
    // initialDistributed = sum of totalPrimeDistributed across all prior single-use
    // PrimeRtknAirdropDistributor instances that served that converter (measured
    // on-chain via tools/scripts/analyze-rtkn-airdrops.js on 2026-04-15).
    const cap1 = "2047932817894880023215861";               // 2,047,932.817895 PRIME
    const initialDistributed1 = "682644278141312562582682"; //   682,644.278141 PRIME
    const cap2 = "52390082479052613054074";                 //    52,390.082479 PRIME
    const initialDistributed2 = "17463360967299292564219";  //    17,463.360967 PRIME

    await deployAndInitialize({
        deploy,
        deployer,
        instanceLabel: "#1",
        deploymentName: "ReusablePrimeDistributor",
        primeToken,
        rTKNConverter: rTKNConverter1,
        distributionCap: cap1,
        initialDistributed: initialDistributed1,
    });

    await deployAndInitialize({
        deploy,
        deployer,
        instanceLabel: "#2",
        deploymentName: "ReusablePrimeDistributor2",
        primeToken,
        rTKNConverter: rTKNConverter2,
        distributionCap: cap2,
        initialDistributed: initialDistributed2,
    });
};

module.exports.tags = ["arbitrum-reusable-prime-distributor"];
