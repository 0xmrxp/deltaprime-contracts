// Historical PRIME airdrop audit.
//
// For every distribution tx listed in the AIRDROP PROGRESS sheet, resolve the
// single-use PrimeRtknAirdropDistributor contract, read its on-chain state,
// group by rTKNConverter, and produce a per-converter cap analysis for the
// new ReusablePrimeDistributor.
//
// Usage: node tools/scripts/analyze-rtkn-airdrops.js

const { ethers } = require("ethers");

const RPC = {
    avalanche: "https://api.avax.network/ext/bc/C/rpc",
    arbitrum: "https://arb1.arbitrum.io/rpc",
};

const CONVERTERS = {
    avalanche: ["0x6632409698454E3FAE685Eaa4d6fdC5b6e9b7716"],
    arbitrum: [
        "0xAd2E3761f071026ed1619876937a0eeC5c3c98B4",
        "0xC1E3efF128c090A434927B0ff779d555bB3F75E5",
    ],
};

// Column order from spreadsheet: Avax tx 1, Arb tx 1, Arb tx 2
// Arb tx 1 corresponds to converter 0xAd2E3761...
// Arb tx 2 corresponds to converter 0xC1E3efF...
const PERIODS = [
    { period: 1,  date: "2025-07-15", avax: "0xa20ac0d7552b05cb6fff7c74631fec7f5a5a2d58c7a16d99909d9ed3529766ba", arb1: "0x379868efeca53865b7672fd4f0462c9175550a3f68a0b7befe2631e8ee33ac66", arb2: "0x27dc9f6d0aaa52d2a29de121323b3f4005508d5b3eb1aa887b8f3a550fa4a0df", listedPrime: 66522.27083 },
    { period: 2,  date: "2025-07-31", avax: "0xeadd12337fa2eede6fc114e09965b3f24f69a8141d56b829b82b06ddc7d40653", arb1: "0xe731641e98af51c81bdc31c0a1d10977a67a237ef58c683a53f0a6bc71524ece", arb2: "0x87cc6cd4b822ac15129a486a0e129e362fc7dd3912bdf0dd6a88dee0b53b2808", listedPrime: 66522.27083 },
    { period: 3,  date: "2025-08-20", avax: "0x187360a51baa9648a48d2e42040ccc62d695471f6639aa24b745c657586e10ff", arb1: "0xa8736a15f83d7ca85213a5156d875992b3294613320200bbfa1e9e39f01fda9f", arb2: "0xb6c6c073d868431a90a3a68c84b89518dbbf99e9ea1670044e448970253f7915", listedPrime: 66522.27083 },
    { period: 7,  date: "2025-10-07", avax: "0xbbff09a2b2aaa73c91e8e24180b89fe77930b61db1c1d3be1837d72b0f4b823f", arb1: "0x8908316a9454db4e7fb087fd90a1d3ac0176dc16b03510e1d941ba09a239b83f", arb2: "0x01e9ee68064f48efed219cac02d241fcae9f089b6bc5e1176bda3829a1b78301", listedPrime: 266089.0833, combinesPeriods: [4,5,6,7] },
    { period: 10, date: "2025-11-24", avax: "0xe8610edcfeade82b569c8ef28ac25a35e0a7a6fde16468fbb2030c0f077f5c7a", arb1: "0xbf6184084cbeef85a1483ea227ff21fffd0f47bafd785973ceeb79dbab03faaa", arb2: "0x750aab07ff752aebe1210b8a5bb05f4aec9f41b6b560b78dacdcea0bd4a14953", listedPrime: 199566.8125, combinesPeriods: [8,9,10] },
    { period: 13, date: "2026-01-09", avax: "0xf292d7831e7d1b2555e9bf9138d29d7ec891d7dce1746df0e8d2cb27ace76d67", arb1: "0x469ac0063dcf33e27656a522579f6c8e35b73b9b90a4ce9a296957ce5607ce6a", arb2: "0xd12faca3b9d3eacc65a7e7cc2cce84ab6a5b4c8ccca2955a1ef6b62415e4786b", listedPrime: null, combinesPeriods: [11,12,13] },
    { period: 16, date: "2026-02-03", avax: "0x48afbad10c8f35ba59e48bb8d6ae7f212a6e2f42630daca85c1d71fa6a943110", arb1: "0x816cfe2d2f3cd19694375a986d091ee8f3f058cd7b0041bb2bddcabd9087679e", arb2: "0xd45ef79e415a94b1985010f3b381b17cbf28c2bc215798ca80c9c073144148eb", listedPrime: 199566.8125, combinesPeriods: [14,15,16] },
];

const DISTRIBUTOR_ABI = [
    "function rTKNConverter() view returns (address)",
    "function primeToken() view returns (address)",
    "function distributionPercentage() view returns (uint256)",
    "function totalPrimeDistributed() view returns (uint256)",
    "function totalAllocation() view returns (uint256)",
    "function currentPhase() view returns (uint8)",
    "function currentAirdropIndex() view returns (uint256)",
    "function currentProcessingIndex() view returns (uint256)",
    "function eligibleUsers(uint256) view returns (address)",
];

const CONVERTER_ABI = [
    "function totalrTKNPledged() view returns (uint256)",
    "function CONVERSION_RATIO() view returns (uint256)",
    "function getTotalUsers() view returns (uint256)",
];

const fmt = (bn, decimals = 18) => ethers.utils.formatUnits(bn, decimals);

async function main() {
    const providers = {
        avalanche: new ethers.providers.JsonRpcProvider(RPC.avalanche),
        arbitrum: new ethers.providers.JsonRpcProvider(RPC.arbitrum),
    };

    // --- Step 1: resolve every tx hash to its distributor contract ("to") ---
    console.log("=== Step 1: resolve tx hashes to distributor addresses ===");
    const rows = []; // {period, date, chain, tx, distributor, label}
    for (const p of PERIODS) {
        for (const [label, chain, tx] of [
            ["avax", "avalanche", p.avax],
            ["arb1", "arbitrum", p.arb1],
            ["arb2", "arbitrum", p.arb2],
        ]) {
            const t = await providers[chain].getTransaction(tx);
            rows.push({ period: p.period, date: p.date, chain, tx, distributor: ethers.utils.getAddress(t.to), label });
        }
    }
    for (const r of rows) {
        console.log(`  period ${String(r.period).padStart(2)} [${r.chain}/${r.label}] -> ${r.distributor}`);
    }

    // --- Step 2: dedupe distributors & read state ---
    console.log("\n=== Step 2: read distributor state ===");
    const byChain = {};
    for (const r of rows) {
        byChain[r.chain] = byChain[r.chain] || new Set();
        byChain[r.chain].add(r.distributor);
    }

    const distributorState = {};
    for (const chain of Object.keys(byChain)) {
        for (const addr of byChain[chain]) {
            const c = new ethers.Contract(addr, DISTRIBUTOR_ABI, providers[chain]);
            const [converter, pct, distributed, alloc, phase, airdropIdx, procIdx] = await Promise.all([
                c.rTKNConverter(),
                c.distributionPercentage(),
                c.totalPrimeDistributed(),
                c.totalAllocation(),
                c.currentPhase(),
                c.currentAirdropIndex(),
                c.currentProcessingIndex(),
            ]);
            distributorState[`${chain}:${addr}`] = {
                chain, addr, converter: ethers.utils.getAddress(converter),
                pct, distributed, alloc, phase, airdropIdx, procIdx,
            };
            console.log(
                `  [${chain}] ${addr}\n` +
                `     converter:     ${converter}\n` +
                `     pct (1e18):    ${pct.toString()} (= ${(Number(pct) / 1e18 * 100).toFixed(4)}%)\n` +
                `     distributed:   ${fmt(distributed)} PRIME\n` +
                `     totalAllocated:${fmt(alloc)} PRIME\n` +
                `     phase:         ${phase} (0=Processing, 1=Airdropping)\n` +
                `     airdropIdx:    ${airdropIdx.toString()}\n` +
                `     procIdx:       ${procIdx.toString()}`
            );
        }
    }

    // --- Step 3: per-converter sums ---
    console.log("\n=== Step 3: per-converter distribution sums ===");
    const perConverter = {};
    for (const s of Object.values(distributorState)) {
        const key = `${s.chain}:${s.converter}`;
        perConverter[key] = perConverter[key] || {
            chain: s.chain, converter: s.converter,
            distributors: [], totalDistributed: ethers.BigNumber.from(0),
        };
        perConverter[key].distributors.push(s);
        perConverter[key].totalDistributed = perConverter[key].totalDistributed.add(s.distributed);
    }

    // --- Step 4: converter cap ---
    console.log("\n=== Step 4: converter cap (totalrTKNPledged × CONVERSION_RATIO) ===");
    for (const chain of Object.keys(CONVERTERS)) {
        for (const conv of CONVERTERS[chain]) {
            const c = new ethers.Contract(conv, CONVERTER_ABI, providers[chain]);
            const [pledged, ratio, nUsers] = await Promise.all([
                c.totalrTKNPledged(), c.CONVERSION_RATIO(), c.getTotalUsers(),
            ]);
            const cap = pledged.mul(ratio).div(ethers.BigNumber.from(10).pow(18));
            const key = `${chain}:${ethers.utils.getAddress(conv)}`;
            const pc = perConverter[key] || { distributors: [], totalDistributed: ethers.BigNumber.from(0) };
            const remaining = cap.sub(pc.totalDistributed);
            console.log(
                `\n  [${chain}] converter ${conv}\n` +
                `     totalrTKNPledged:   ${fmt(pledged)} rTKN (raw: ${pledged.toString()})\n` +
                `     CONVERSION_RATIO:   ${fmt(ratio)} (raw: ${ratio.toString()})\n` +
                `     getTotalUsers:      ${nUsers.toString()}\n` +
                `     CAP (pledged×ratio):${fmt(cap)} PRIME\n` +
                `     distributors seen:  ${pc.distributors.length}\n` +
                `     SUM distributed:    ${fmt(pc.totalDistributed)} PRIME\n` +
                `     REMAINING to dist:  ${fmt(remaining)} PRIME`
            );
        }
    }

    // --- Step 5: grand total (for reconciliation with spreadsheet 864789.52) ---
    const grandTotal = Object.values(distributorState).reduce(
        (acc, s) => acc.add(s.distributed), ethers.BigNumber.from(0)
    );
    console.log(`\n=== Grand total PRIME distributed (all converters): ${fmt(grandTotal)} PRIME ===`);
}

main().catch((e) => { console.error(e); process.exit(1); });
