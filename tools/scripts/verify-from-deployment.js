/**
 * verify-from-deployment.js
 *
 * Block-explorer source verification that is immune to the two failure modes hit
 * when verifying the audit-fixes-feb2026 redeploy:
 *
 *   1. Working-tree drift. hardhat-verify recompiles the *current* sources; if a
 *      linter or a later edit touches a file after deployment, the Solidity
 *      metadata hash shifts and the recompiled bytecode no longer matches what is
 *      on-chain. This helper instead submits the EXACT solc input hardhat-deploy
 *      saved at deploy time (deployments/<net>/solcInputs/<hash>.json).
 *
 *   2. solc-wasm OOM. hardhat-deploy's saved solc input bundles the whole project
 *      (200-300 sources); Routescan's solc-wasm runs out of memory compiling it.
 *      This helper rebuilds a MINIMAL input containing only the contract's actual
 *      import closure (from its solc metadata), with byte-identical content
 *      cross-checked against the metadata keccak256 hashes, plus a narrowed
 *      outputSelection. Same closure + same settings => identical metadata hash
 *      => identical bytecode.
 *
 * External-library links are read from the deployment artifact's own `libraries`
 * field (hardhat-deploy records it there), so there is no hand-maintained "which
 * facets link a library" list to keep in sync.
 *
 * Exports:
 *   verifyDeployment(hre, name)  -> { name, address, ok, detail }
 *   verifyAllManifests(hre)      -> { results, allOk }
 *   writeManifest(hre, tag, names) -> manifest file path
 *   buildMinimalInput(hre, name) -> { address, fqn, compiler, libraries, sourceCode }
 *   MANIFEST_SUFFIX
 */

const fs = require("fs");
const path = require("path");
const { keccak256, toUtf8Bytes } = require("ethers/lib/utils");

const MANIFEST_SUFFIX = ".verify-manifest.json";
const SUBMIT_RETRIES = 3;
const POLL_INTERVAL_MS = 15000;
const POLL_MAX = 24; // 24 * 15s = 6 min per attempt
const RETRY_BACKOFF_MS = 30000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Explorer endpoints keyed by chainId. Avalanche must stay on Routescan because
// snowtrace.io reads Routescan, not Etherscan. Arbitrum uses the Etherscan v2
// multichain endpoint.
function explorerFor(chainId) {
    if (chainId === 43114) {
        return {
            // Routescan's etherscan-compat API does not require an api key.
            apiUrl: "https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan/api",
            apiKey: process.env.ETHERSCAN_API_KEY || "",
        };
    }
    if (chainId === 42161) {
        return {
            apiUrl: "https://api.etherscan.io/v2/api?chainid=42161",
            apiKey: process.env.ETHERSCAN_API_KEY || "",
        };
    }
    throw new Error(`verify-from-deployment: no explorer configured for chainId ${chainId}`);
}

function deploymentsDir(hre) {
    return path.join(hre.config.paths.root, "deployments", hre.network.name);
}

/**
 * Build a minimal Standard JSON input for `name` from its saved deployment
 * artifact + solcInput. Throws if a closure source is missing or its content
 * does not match the metadata keccak256 (which would mean the saved solcInput
 * and the artifact disagree — never submit in that case).
 */
function buildMinimalInput(hre, name) {
    const dir = deploymentsDir(hre);
    const artifact = JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf8"));
    if (!artifact.solcInputHash) {
        throw new Error(`${name}: deployment artifact has no solcInputHash`);
    }
    const metadata = JSON.parse(artifact.metadata);
    const bigInput = JSON.parse(
        fs.readFileSync(path.join(dir, "solcInputs", `${artifact.solcInputHash}.json`), "utf8"),
    );

    const sources = {};
    for (const srcPath of Object.keys(metadata.sources)) {
        const entry = bigInput.sources[srcPath];
        if (!entry) throw new Error(`${name}: source missing from solcInput: ${srcPath}`);
        const expected = metadata.sources[srcPath].keccak256;
        if (expected) {
            const actual = keccak256(toUtf8Bytes(entry.content));
            if (actual.toLowerCase() !== expected.toLowerCase()) {
                throw new Error(`${name}: keccak256 mismatch for ${srcPath} (solcInput and artifact disagree)`);
            }
        }
        sources[srcPath] = { content: entry.content };
    }

    // outputSelection only affects what solc emits, never what it compiles, so
    // narrowing it leaves bytecode + metadata untouched while cutting solc-wasm
    // peak memory — this is what avoids the Routescan OOM on large facets.
    const settings = {
        ...bigInput.settings,
        outputSelection: {
            "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object", "metadata"] },
        },
    };

    // hardhat-deploy links external libraries AFTER compilation, so the saved
    // solcInput has no settings.libraries. Re-inject from the artifact's recorded
    // libraries so solc links at compile time and produces the on-chain bytecode.
    if (artifact.libraries && Object.keys(artifact.libraries).length > 0) {
        settings.libraries = {};
        for (const [libName, libAddr] of Object.entries(artifact.libraries)) {
            const libPath = Object.keys(sources).find(
                (p) => p === `${libName}.sol` || p.endsWith(`/${libName}.sol`),
            );
            if (!libPath) {
                throw new Error(`${name}: cannot locate source path for library ${libName}`);
            }
            settings.libraries[libPath] = { [libName]: libAddr };
        }
    }

    const [fqnPath, fqnName] = Object.entries(metadata.settings.compilationTarget)[0];
    return {
        address: artifact.address,
        fqn: `${fqnPath}:${fqnName}`,
        compiler: `v${metadata.compiler.version}`,
        libraries: artifact.libraries || null,
        sourceCode: JSON.stringify({ language: "Solidity", sources, settings }),
    };
}

async function safeJson(res) {
    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch {
        return { status: "0", message: "NOTOK", result: `non-JSON response: ${text.slice(0, 200)}` };
    }
}

async function explorerPost(explorer, action, params) {
    const sep = explorer.apiUrl.includes("?") ? "&" : "?";
    const url = `${explorer.apiUrl}${sep}module=contract&action=${action}&apikey=${explorer.apiKey}`;
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(params),
    });
    return safeJson(res);
}

async function explorerGet(explorer, action, params) {
    const sep = explorer.apiUrl.includes("?") ? "&" : "?";
    const qs = new URLSearchParams({ module: "contract", action, apikey: explorer.apiKey, ...params });
    const res = await fetch(`${explorer.apiUrl}${sep}${qs}`);
    return safeJson(res);
}

const isVerified = (s) => {
    s = String(s || "").toLowerCase();
    return s.includes("pass") || s.includes("already verified");
};
const isPending = (s) => String(s || "").toLowerCase().includes("pending");

/**
 * Verify a single deployment by its hardhat-deploy artifact name.
 * Idempotent — re-running an already-verified contract returns ok.
 * @returns {{ name: string, address: string|null, ok: boolean, detail: string }}
 */
async function verifyDeployment(hre, name) {
    const explorer = explorerFor(hre.network.config.chainId);

    let built;
    try {
        built = buildMinimalInput(hre, name);
    } catch (e) {
        return { name, address: null, ok: false, detail: `build failed: ${e.message}` };
    }

    for (let attempt = 1; attempt <= SUBMIT_RETRIES; attempt++) {
        let submit;
        try {
            submit = await explorerPost(explorer, "verifysourcecode", {
                codeformat: "solidity-standard-json-input",
                contractaddress: built.address,
                contractname: built.fqn,
                compilerversion: built.compiler,
                sourceCode: built.sourceCode,
                constructorArguements: "",
            });
        } catch (e) {
            if (attempt < SUBMIT_RETRIES) {
                await sleep(RETRY_BACKOFF_MS);
                continue;
            }
            return { name, address: built.address, ok: false, detail: `submit error: ${e.message}` };
        }

        if (submit.status !== "1") {
            if (isVerified(submit.result)) {
                return { name, address: built.address, ok: true, detail: "already verified" };
            }
            // Transient submit error (e.g. Routescan solc-wasm OOM) — retry.
            if (attempt < SUBMIT_RETRIES) {
                await sleep(RETRY_BACKOFF_MS);
                continue;
            }
            return { name, address: built.address, ok: false, detail: `submit failed: ${submit.result}` };
        }

        const guid = submit.result;
        let retrySubmit = false;
        for (let i = 0; i < POLL_MAX; i++) {
            await sleep(POLL_INTERVAL_MS);
            let st;
            try {
                st = await explorerGet(explorer, "checkverifystatus", { guid });
            } catch {
                continue; // transient network error during poll — keep polling
            }
            if (isVerified(st.result)) {
                return { name, address: built.address, ok: true, detail: String(st.result) };
            }
            if (isPending(st.result)) continue;
            // Hard failure for this attempt (compile error / OOM / mismatch).
            if (attempt < SUBMIT_RETRIES) {
                retrySubmit = true;
                break;
            }
            return { name, address: built.address, ok: false, detail: String(st.result) };
        }
        if (retrySubmit) {
            await sleep(RETRY_BACKOFF_MS);
            continue;
        }
        // Poll window exhausted while still pending.
        if (attempt < SUBMIT_RETRIES) {
            await sleep(RETRY_BACKOFF_MS);
            continue;
        }
        return { name, address: built.address, ok: false, detail: "timed out (still pending)" };
    }
    return { name, address: built ? built.address : null, ok: false, detail: "exhausted retries" };
}

function manifestPath(hre, tag) {
    return path.join(deploymentsDir(hre), `${tag}${MANIFEST_SUFFIX}`);
}

/**
 * Write a verification manifest listing the contracts a deploy touched, so the
 * batch can be re-verified later (verify-deployments.js) without re-deploying.
 */
function writeManifest(hre, tag, names) {
    const file = manifestPath(hre, tag);
    fs.writeFileSync(
        file,
        JSON.stringify({ tag, network: hre.network.name, contracts: names }, null, 2) + "\n",
    );
    return file;
}

/**
 * Verify every contract listed in every *.verify-manifest.json under the current
 * network's deployments dir. Used by the standalone verify-deployments.js script;
 * re-runnable as many times as needed (verification is idempotent).
 */
async function verifyAllManifests(hre) {
    const dir = deploymentsDir(hre);
    const manifests = fs.existsSync(dir)
        ? fs.readdirSync(dir).filter((f) => f.endsWith(MANIFEST_SUFFIX))
        : [];
    if (manifests.length === 0) {
        console.log(`No ${MANIFEST_SUFFIX} files in ${dir}`);
        return { results: [], allOk: true };
    }

    const names = [];
    for (const m of manifests) {
        const manifest = JSON.parse(fs.readFileSync(path.join(dir, m), "utf8"));
        for (const n of manifest.contracts || []) {
            if (!names.includes(n)) names.push(n);
        }
    }

    const results = [];
    for (const name of names) {
        console.log(`\n--- verifying ${name} (${hre.network.name}) ---`);
        const r = await verifyDeployment(hre, name);
        console.log(`${r.ok ? "✅" : "❌"} ${name}: ${r.detail}`);
        results.push(r);
    }

    const allOk = results.every((r) => r.ok);
    console.log("\n=== verification summary ===");
    for (const r of results) {
        console.log(`  ${r.ok ? "✅" : "❌"} ${r.name.padEnd(38)} ${r.address || ""}`);
    }
    return { results, allOk };
}

module.exports = {
    verifyDeployment,
    verifyAllManifests,
    writeManifest,
    buildMinimalInput,
    MANIFEST_SUFFIX,
};
