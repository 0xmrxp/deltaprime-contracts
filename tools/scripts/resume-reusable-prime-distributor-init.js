// Resume-initialize a ReusablePrimeDistributor after its deploy script was
// interrupted (e.g. verification poll hang). Idempotent: safe to re-run.
//
// Usage:
//   npx hardhat run --network <avalanche|arbitrum> \
//       tools/scripts/resume-reusable-prime-distributor-init.js
//
// Configure the target address + multisig below per chain.

const hre = require("hardhat");

const CACHE_BATCH_SIZE = 250;

const TARGETS = {
    avalanche: [
        {
            address: "0x1e634d6a1Cd721aC95f622B59ddD561efB08fdB5",
            ownerMultisig: "0x44AfCcF712E8A097a6727B48b57c75d7A85a9B0c",
        },
    ],
    // Arbitrum entries will be filled in after those deploys run.
    arbitrum: [],
};

async function finalize({ address, ownerMultisig }) {
    const { ethers } = hre;
    const distributor = await ethers.getContractAt(
        "ReusablePrimeDistributor",
        address
    );

    console.log(`\n--- Finalizing ${address} ---`);

    const currentOwner = await distributor.owner();
    console.log(`Current owner: ${currentOwner}`);

    if (currentOwner.toLowerCase() === ownerMultisig.toLowerCase()) {
        console.log(`Already owned by multisig — nothing to do.`);
        return;
    }

    let batch = 0;
    while (!(await distributor.usersCached())) {
        batch++;
        const tx = await distributor.cacheUsers(CACHE_BATCH_SIZE);
        await tx.wait();
        const [cached, total] = await distributor.getCachingProgress();
        console.log(
            `cacheUsers batch ${batch}: ${cached.toString()}/${total.toString()} (tx: ${tx.hash})`
        );
    }

    const totalCached = await distributor.getTotalCachedUsers();
    const totalShares = await distributor.totalShares();
    console.log(
        `Caching complete — ${totalCached.toString()} users, ${totalShares.toString()} total shares`
    );

    console.log(`Transferring ownership to ${ownerMultisig}...`);
    const tx = await distributor.transferOwnership(ownerMultisig);
    await tx.wait();
    console.log(`Ownership transferred (tx: ${tx.hash})`);

    const newOwner = await distributor.owner();
    if (newOwner.toLowerCase() !== ownerMultisig.toLowerCase()) {
        throw new Error(
            `Ownership transfer failed: owner is ${newOwner}, expected ${ownerMultisig}`
        );
    }
    console.log(`Verified new owner: ${newOwner}`);
}

async function main() {
    const networkName = hre.network.name;
    const targets = TARGETS[networkName];
    if (!targets || targets.length === 0) {
        throw new Error(`No targets configured for network ${networkName}`);
    }
    for (const t of targets) {
        await finalize(t);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
