const { ethers } = require("ethers");

const RPC = {
    avalanche: "https://api.avax.network/ext/bc/C/rpc",
    arbitrum: "https://arb1.arbitrum.io/rpc",
};

const INSTANCES = [
    { chain: "avalanche", label: "Avax",          addr: "0xE202C0Ef9CAAbC29edC55ae0e47b1096Cb0e3bfe", multisig: "0x44AfCcF712E8A097a6727B48b57c75d7A85a9B0c" },
    { chain: "arbitrum",  label: "Arb #1 (Ad2E)", addr: "0xdCE1E5d56192604F301d9384Fd46eD7EBd885F3e", multisig: "0xDfA6706FC583b635CD6daF0E3915901A2fBaBAaD" },
    { chain: "arbitrum",  label: "Arb #2 (C1E3)", addr: "0x90aB083De7B2d658652FFd7da9481D768AcC2620", multisig: "0xDfA6706FC583b635CD6daF0E3915901A2fBaBAaD" },
];

const ABI = [
    "function owner() view returns (address)",
    "function primeToken() view returns (address)",
    "function rTKNConverter() view returns (address)",
    "function distributionCap() view returns (uint256)",
    "function initialDistributed() view returns (uint256)",
    "function totalPrimeDistributed() view returns (uint256)",
    "function usersCached() view returns (bool)",
    "function getTotalCachedUsers() view returns (uint256)",
    "function totalShares() view returns (uint256)",
    "function getRemainingDistributable() view returns (uint256)",
];

const fmt = (bn) => ethers.utils.formatUnits(bn, 18);

(async () => {
    const providers = {
        avalanche: new ethers.providers.JsonRpcProvider(RPC.avalanche),
        arbitrum: new ethers.providers.JsonRpcProvider(RPC.arbitrum),
    };

    for (const i of INSTANCES) {
        const c = new ethers.Contract(i.addr, ABI, providers[i.chain]);
        const [owner, prime, conv, cap, init, dist, cached, nCached, shares, rem] = await Promise.all([
            c.owner(), c.primeToken(), c.rTKNConverter(), c.distributionCap(),
            c.initialDistributed(), c.totalPrimeDistributed(), c.usersCached(),
            c.getTotalCachedUsers(), c.totalShares(), c.getRemainingDistributable(),
        ]);
        const ownerOK = owner.toLowerCase() === i.multisig.toLowerCase();
        console.log(
            `\n=== ${i.label} @ ${i.addr} (${i.chain}) ===\n` +
            `  owner:                 ${owner} ${ownerOK ? "✓ multisig" : "✗ NOT multisig!"}\n` +
            `  primeToken:            ${prime}\n` +
            `  rTKNConverter:         ${conv}\n` +
            `  distributionCap:       ${fmt(cap)} PRIME (${cap.toString()})\n` +
            `  initialDistributed:    ${fmt(init)} PRIME (${init.toString()})\n` +
            `  totalPrimeDistributed: ${fmt(dist)} PRIME\n` +
            `  usersCached:           ${cached}\n` +
            `  cachedUsers count:     ${nCached.toString()}\n` +
            `  totalShares:           ${fmt(shares)} (${shares.toString()})\n` +
            `  remaining to dist:     ${fmt(rem)} PRIME`
        );
    }
})();
