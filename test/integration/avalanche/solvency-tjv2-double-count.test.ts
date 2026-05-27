// Regression test for the PR #102 bug where TraderJoe V2 bin-token prices
// were appended to CachedPrices.ownedAssetsPrices, causing any token that
// was both owned AND a tokenX/tokenY of a TJv2 bin to be summed twice by
// _getTotalAssetsValueBase / _getTWVOwnedAssets. The fix (this PR) moves
// those prices into a dedicated CachedPrices.tjv2TokenPrices slot.
//
// The suite is intentionally self-contained and does not touch the shared
// solvency-facet-prod.test.ts fixtures — it skips the Pangolin / YieldYak
// facets that are no longer present in this mirror, and funds USDC by
// impersonating a whale instead of going through a DEX swap.

import { ethers, waffle } from "hardhat";
import chai, { expect } from "chai";
import { BigNumber, Contract } from "ethers";
import { solidity } from "ethereum-waffle";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { WrapperBuilder } from "@redstone-finance/evm-connector";
import * as traderJoeSdk from "@traderjoe-xyz/sdk-v2";
import { TokenAmount } from "@traderjoe-xyz/sdk-core";
import { JSBI } from "@traderjoe-xyz/sdk";
import { Token } from "@traderjoe-xyz/sdk-core";
import { parseUnits } from "ethers/lib/utils";

import SmartLoansFactoryArtifact from "../../../artifacts/contracts/SmartLoansFactory.sol/SmartLoansFactory.json";
import MockTokenManagerArtifact from "../../../artifacts/contracts/mock/MockTokenManager.sol/MockTokenManager.json";
import AddressProviderArtifact from "../../../artifacts/contracts/AddressProvider.sol/AddressProvider.json";

import {
  addMissingTokenContracts,
  Asset,
  convertAssetsListToSupportedAssets,
  convertTokenPricesMapToMockPrices,
  deployPools,
  erc20ABI,
  fromWei,
  getFixedGasSigners,
  getRedstonePrices,
  getTokensPricesMap,
  PoolAsset,
  PoolInitializationObject,
  recompileConstantsFile,
  syncTime,
  toBytes32,
  toWei,
  wavaxAbi,
} from "../../_helpers";

import {
  AddressProvider,
  MockTokenManager,
  SmartLoanGigaChadInterface,
  SmartLoansFactory,
} from "../../../typechain";

import { deployDiamond } from "../../../tools/diamond/deploy-diamond";
const { deployFacet } = require("../../../tools/diamond/deploy-diamond");
import TOKEN_ADDRESSES from "../../../common/addresses/avax/token_addresses.json";

chai.use(solidity);
const { deployContract, provider } = waffle;

// Real Avalanche addresses used on the fork
const TJV2_ROUTER_V2_1 = "0xb4315e873dBcf96Ffd0acd8EA43f689D8c20fB30";
const AVAX_USDC_LB_PAIR = "0xD446eb1660F766d533BeCeEf890Df7A69d26f7d1"; // 20 bps
// GMX Vault on Avalanche — holds sizeable real USDC. We impersonate it to
// side-step the defunct PangolinIntermediary swap path in the original suite.
const USDC_WHALE = "0x9ab2De34A33fB459b538c43f251eB825645e8595";

const LBPairABI = [
  "function getReserves() public view returns (uint128, uint128)",
  "function getActiveId() public view returns (uint24)",
  "function balanceOf(address, uint256) public view returns (uint256)",
  "function getBin(uint24) public view returns (uint128, uint128)",
  "function totalSupply(uint256) public view returns (uint256)",
];

// Helper cloned from solvency-facet-prod.test.ts — builds TJv2 add-liquidity params.
function getAddLiquidityParameters(
  to: string,
  tokenX: any,
  tokenY: any,
  tokenXValue: string,
  tokenYValue: string,
  distributionMethod: string,
  binStep: number,
  activeBinId: number,
  binRange: number[],
  userPriceSlippage: number,
  userAmountsSlippage: number
) {
  const tokenXAmount = new TokenAmount(tokenX, JSBI.BigInt(tokenXValue));
  const tokenYAmount = new TokenAmount(tokenY, JSBI.BigInt(tokenYValue));

  const allowedAmountsSlippage = userAmountsSlippage * 100;
  const minTokenXAmount = JSBI.divide(
    JSBI.multiply(tokenXAmount.raw, JSBI.BigInt(10000 - allowedAmountsSlippage)),
    JSBI.BigInt(10000)
  );
  const minTokenYAmount = JSBI.divide(
    JSBI.multiply(tokenYAmount.raw, JSBI.BigInt(10000 - allowedAmountsSlippage)),
    JSBI.BigInt(10000)
  );

  const priceSlippage = (userPriceSlippage * 100) / 10000;
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const idSlippage = Math.floor(Math.log(1 + priceSlippage) / Math.log(1 + binStep / 1e4));

  let { deltaIds, distributionX, distributionY } = (traderJoeSdk as any)[distributionMethod](
    activeBinId,
    binRange,
    [tokenXAmount, tokenYAmount]
  );
  distributionX = distributionX.map((el: any) =>
    BigInt(el) > BigInt(10) ? BigInt(el) - BigInt(10) : BigInt(el)
  );
  distributionY = distributionY.map((el: any) =>
    BigInt(el) > BigInt(10) ? BigInt(el) - BigInt(10) : BigInt(el)
  );

  return {
    tokenX: tokenX.address,
    tokenY: tokenY.address,
    binStep: Number(binStep),
    amountX: tokenXAmount.raw.toString(),
    amountY: tokenYAmount.raw.toString(),
    amountXMin: minTokenXAmount.toString(),
    amountYMin: minTokenYAmount.toString(),
    activeIdDesired: activeBinId,
    idSlippage,
    deltaIds,
    distributionX,
    distributionY,
    to,
    refundTo: to,
    deadline,
  };
}

// Deploy only the minimum facet set the invariant test needs — avoids the
// Pangolin / YieldYak / Beefy facets that are missing from this public mirror.
async function deployMinimalFacets(diamondAddress: string) {
  const diamondCut = await ethers.getContractAt("IDiamondCut", diamondAddress);
  await diamondCut.pause();

  await deployFacet("OwnershipFacet", diamondAddress, [
    "proposeOwnershipTransfer",
    "acceptOwnership",
    "owner",
    "proposedOwner",
    "pauseAdmin",
    "proposedPauseAdmin",
  ]);

  await deployFacet("WithdrawalIntentFacet", diamondAddress, [
    "createWithdrawalIntent",
    "executeWithdrawalIntent",
    "cancelWithdrawalIntent",
    "clearExpiredIntents",
    "getUserIntents",
    "getTotalIntentAmount",
    "getAvailableBalance",
    "getAvailableBalancePayable",
  ]);

  await deployFacet("HealthMeterFacetMock", diamondAddress, ["getHealthMeter"]);

  // Use the Mock variant (authorises RedStone mock signers + disables timestamp
  // check) but it inherits SolvencyFacetProd unchanged, so the getAllPricesForLiquidation
  // code path under test is the real one.
  await deployFacet("SolvencyFacetMockAvalanche", diamondAddress, [
    "canRepayDebtFully",
    "isSolvent",
    "isSolventPayable",
    "isSolventWithPrices",
    "getOwnedAssetsWithNativePrices",
    "getOwnedAssetsWithNative",
    "getHealthRatioWithPrices",
    "getDebtAssets",
    "getDebtAssetsPrices",
    "getStakedPositionsPrices",
    "getAllPricesForLiquidation",
    "getDebt",
    "getDebtPayable",
    "getDebtWithPrices",
    "getPrice",
    "getPrices",
    "getTotalAssetsValue",
    "getThresholdWeightedValue",
    "getThresholdWeightedValuePayable",
    "getStakedValue",
    "getTotalValue",
    "getFullLoanStatus",
    "getHealthRatio",
    "getTotalTraderJoeV2",
  ]);

  await deployFacet("AssetsOperationsFacet", diamondAddress, [
    "borrow",
    "repay",
    "fund",
    "fundGLP",
    "withdrawUnsupportedToken",
    "removeUnsupportedStakedPosition",
    "removeUnsupportedOwnedAsset",
  ]);

  await deployFacet("SmartLoanWrappedNativeTokenFacet", diamondAddress, [
    "depositNativeToken",
    "wrapNativeToken",
  ]);

  await deployFacet("TraderJoeV2AvalancheFacet", diamondAddress, [
    "addLiquidityTraderJoeV2",
    "removeLiquidityTraderJoeV2",
    "getOwnedTraderJoeV2Bins",
  ]);

  await deployFacet("SmartLoanLiquidationFacet", diamondAddress, [
    "liquidate",
    "snapshotInsolvency",
    "whitelistLiquidators",
    "delistLiquidators",
    "isLiquidatorWhitelisted",
    "getLastInsolventTimestamp",
  ]);

  await deployFacet("SmartLoanViewFacet", diamondAddress, [
    "initialize",
    "getAllAssetsBalances",
    "getAllAssetsBalancesDebtCoverages",
    "getDebts",
    "getPercentagePrecision",
    "getAccountFrozenSince",
    "getAllAssetsPrices",
    "getBalance",
    "getSupportedTokensAddresses",
    "getAllOwnedAssets",
    "getContractOwner",
    "getProposedOwner",
    "getStakedPositions",
  ]);

  await diamondCut.unpause();
}

describe("SolvencyFacet — TJv2 bin-token double-count regression", () => {
  let owner: SignerWithAddress;
  let depositor: SignerWithAddress;

  let diamondAddress: string;
  let smartLoansFactory: SmartLoansFactory;
  let tokenManager: MockTokenManager;

  const tokenContracts: Map<string, Contract> = new Map();
  const poolContracts: Map<string, Contract> = new Map();
  const lendingPools: Array<PoolAsset> = [];
  let supportedAssets: Array<Asset>;
  let tokensPrices: Map<string, number>;
  let MOCK_PRICES: any;

  let loan: SmartLoanGigaChadInterface;
  let wrappedLoan: any;

  before("sync blockchain time", async () => {
    await syncTime();
  });

  before("deploy diamond + pools + facets", async () => {
    [owner, depositor] = await getFixedGasSigners(10000000);
    depositor = depositor || owner;

    // --- Fund owner + depositor with real USDC via whale impersonation ---
    await provider.send("hardhat_impersonateAccount", [USDC_WHALE]);
    await provider.send("hardhat_setBalance", [
      USDC_WHALE,
      "0x3635c9adc5dea00000", // 1000 AVAX gas budget
    ]);
    const whaleSigner = await ethers.getSigner(USDC_WHALE);
    const usdcAsWhale = new ethers.Contract(
      TOKEN_ADDRESSES["USDC"],
      erc20ABI,
      whaleSigner
    );
    await usdcAsWhale.transfer(owner.address, parseUnits("200000", 6));
    await usdcAsWhale.transfer(depositor.address, parseUnits("50000", 6));
    await provider.send("hardhat_stopImpersonatingAccount", [USDC_WHALE]);

    // Only AVAX + USDC to dodge the stale Avalanche RedStone symbols
    // (sAVAX, GLP, YY_*, PNG_*, WOMBAT_* are no longer served).
    const assetsList = ["AVAX", "USDC"];

    const poolNameAirdropList: Array<PoolInitializationObject> = [
      { name: "AVAX", airdropList: [depositor] },
      // deployPools only airdrops AVAX/MCKUSD; for the USDC pool we deposit
      // manually below using the USDC we just pulled from the whale.
      { name: "USDC", airdropList: [depositor] },
    ];

    diamondAddress = await deployDiamond();
    smartLoansFactory = (await deployContract(
      owner,
      SmartLoansFactoryArtifact
    )) as SmartLoansFactory;
    tokenManager = (await deployContract(
      owner,
      MockTokenManagerArtifact,
      []
    )) as MockTokenManager;

    await deployPools(
      smartLoansFactory,
      poolNameAirdropList,
      tokenContracts,
      poolContracts,
      lendingPools,
      owner,
      depositor,
      2000,
      "AVAX",
      [],
      tokenManager.address
    );

    // Seed the USDC lending pool with depositor-supplied USDC so later
    // tests can borrow if they need to. The invariant test does not need
    // USDC debt, but the liquidation test does.
    const usdcPool = poolContracts.get("USDC")!;
    const usdcToken = new ethers.Contract(
      TOKEN_ADDRESSES["USDC"],
      erc20ABI,
      depositor
    );
    const depositAmount = parseUnits("40000", 6);
    await usdcToken.approve(usdcPool.address, depositAmount);
    await usdcPool.connect(depositor).deposit(depositAmount);

    tokensPrices = await getTokensPricesMap(
      assetsList,
      "avalanche",
      getRedstonePrices,
      []
    );
    MOCK_PRICES = convertTokenPricesMapToMockPrices(tokensPrices);
    supportedAssets = convertAssetsListToSupportedAssets(assetsList);
    addMissingTokenContracts(
      tokenContracts,
      assetsList.filter((a) => !tokenContracts.has(a))
    );

    await tokenManager.connect(owner).initialize(supportedAssets, lendingPools);
    await tokenManager
      .connect(owner)
      .setFactoryAddress(smartLoansFactory.address);

    await smartLoansFactory.initialize(diamondAddress, tokenManager.address);

    const addressProvider = (await deployContract(
      owner,
      AddressProviderArtifact,
      []
    )) as AddressProvider;

    await recompileConstantsFile(
      "local",
      "DeploymentConstants",
      [],
      tokenManager.address,
      addressProvider.address,
      diamondAddress,
      smartLoansFactory.address,
      "lib"
    );

    await deployMinimalFacets(diamondAddress);

    // Pre-wrap 2000 AVAX on owner so fund() has WAVAX to transferFrom.
    const wavax = new ethers.Contract(
      TOKEN_ADDRESSES["AVAX"],
      wavaxAbi,
      provider
    );
    await wavax.connect(owner).deposit({ value: toWei("2000") });
  });

  before("create PA, fund AVAX + USDC, open AVAX/USDC TJv2 bin", async () => {
    await smartLoansFactory.connect(owner).createLoan();
    const loanAddr = await smartLoansFactory.getLoanForOwner(owner.address);
    loan = (await ethers.getContractAt(
      "SmartLoanGigaChadInterface",
      loanAddr,
      owner
    )) as SmartLoanGigaChadInterface;

    wrappedLoan = WrapperBuilder
      // @ts-ignore
      .wrap(loan)
      .usingSimpleNumericMock({
        mockSignersCount: 10,
        dataPoints: MOCK_PRICES,
        // The SDK's DEFAULT_TIMESTAMP_FOR_TESTS is hardcoded to June 2022,
        // which the on-chain RedstoneDefaultsLib.validateTimestamp rejects
        // with TimestampIsTooOld once the fork block is more than 3 minutes
        // newer than the package. Stamp each package with wall-clock time.
        timestampMilliseconds: Date.now(),
      });

    // Fund PA with 1000 AVAX
    const avaxAmount = toWei("1000");
    const wavax = new ethers.Contract(
      TOKEN_ADDRESSES["AVAX"],
      wavaxAbi,
      owner
    );
    await wavax.approve(wrappedLoan.address, avaxAmount);
    await wrappedLoan.fund(toBytes32("AVAX"), avaxAmount);

    // Fund PA with 100,000 USDC
    const usdcAmount = parseUnits("100000", 6);
    const usdc = new ethers.Contract(TOKEN_ADDRESSES["USDC"], erc20ABI, owner);
    await usdc.approve(wrappedLoan.address, usdcAmount);
    await wrappedLoan.fund(toBytes32("USDC"), usdcAmount);

    // Open AVAX/USDC 20 bps TJv2 bin — this is the overlap condition:
    // both AVAX and USDC are in ownedAssets AND are tokenX/tokenY of the bin.
    const lbPair = new ethers.Contract(AVAX_USDC_LB_PAIR, LBPairABI, provider);
    const activeId = await lbPair.getActiveId();
    const tokenX = new Token(
      43114,
      TOKEN_ADDRESSES["AVAX"],
      18,
      "WAVAX",
      "WAVAX"
    );
    const tokenY = new Token(
      43114,
      TOKEN_ADDRESSES["USDC"],
      6,
      "USDC",
      "USDC"
    );

    const addInput = getAddLiquidityParameters(
      wrappedLoan.address,
      tokenX,
      tokenY,
      toWei("50").toString(),
      parseUnits("500", 6).toString(),
      "getUniformDistributionFromBinRange",
      20,
      activeId,
      [activeId - 2, activeId + 2],
      2,
      2
    );
    await wrappedLoan.addLiquidityTraderJoeV2(TJV2_ROUTER_V2_1, addInput);
  });

  it("invariant: getTotalValue === getTotalAssetsValue + getStakedValue + getTotalTraderJoeV2 (wei-exact)", async () => {
    const bins = await wrappedLoan.getOwnedTraderJoeV2Bins();
    expect(bins.length).to.be.greaterThan(
      0,
      "Precondition: PA must have an active AVAX/USDC TJv2 bin"
    );

    const totalValue = await wrappedLoan.getTotalValue();
    const totalAssetsValue = await wrappedLoan.getTotalAssetsValue();
    const stakedValue = await wrappedLoan.getStakedValue();
    const tjv2Value = await wrappedLoan.getTotalTraderJoeV2();

    const recomposed = totalAssetsValue.add(stakedValue).add(tjv2Value);
    const delta = totalValue.sub(recomposed);

    console.log(
      `[overlap] TV=${fromWei(totalValue)}  TAV=${fromWei(totalAssetsValue)}  Staked=${fromWei(
        stakedValue
      )}  TJv2=${fromWei(tjv2Value)}  delta=${fromWei(delta)}`
    );

    // With the bug the delta is ≈ balance×price of the overlapping owned
    // tokens (AVAX + USDC here). After the fix it must be zero to the wei.
    expect(totalValue).to.equal(
      recomposed,
      "getTotalValue must equal getTotalAssetsValue + getStakedValue + getTotalTraderJoeV2"
    );
  });

  it("CachedPrices shape: ownedAssetsPrices sized to owned count, tjv2TokenPrices populated", async () => {
    // SmartLoanGigaChadInterface doesn't list getAllPricesForLiquidation /
    // getOwnedAssetsWithNative, so call them via a SolvencyFacet view of the
    // diamond proxy (wrapped with the same RedStone mock signatures).
    const solvency = await ethers.getContractAt(
      "SolvencyFacetMockAvalanche",
      wrappedLoan.address,
      owner
    );
    const wrappedSolvency = WrapperBuilder
      // @ts-ignore
      .wrap(solvency)
      .usingSimpleNumericMock({
        mockSignersCount: 10,
        dataPoints: MOCK_PRICES,
        timestampMilliseconds: Date.now(),
      });

    const cached = await wrappedSolvency.getAllPricesForLiquidation([]);
    const ownedWithNative = await wrappedSolvency.getOwnedAssetsWithNative();

    expect(cached.ownedAssetsPrices.length).to.equal(
      ownedWithNative.length,
      "ownedAssetsPrices must not include TJv2 bin tokens"
    );
    // AVAX/USDC bin → 2 unique bin tokens
    expect(cached.tjv2TokenPrices.length).to.equal(
      2,
      "tjv2TokenPrices should carry bin-token prices (tokenX + tokenY)"
    );
  });

  it("no-overlap regression: removing the TJv2 bin leaves the invariant intact", async () => {
    // Remove every bin, then re-check the invariant. This exercises the
    // code path where tjv2TokenSymbols.length == 0 — the fix must not change
    // behaviour vs. the pre-fix code in this case.
    const bins = await wrappedLoan.getOwnedTraderJoeV2Bins();
    if (bins.length === 0) {
      return; // already no bin, nothing to remove
    }

    // Collect LP balances per bin id (addLiquidity seeded a 5-bin range).
    const lbToken = await ethers.getContractAt(
      [
        "function balanceOf(address account, uint256 id) external view returns (uint256)",
      ],
      bins[0].pair,
      owner
    );
    const ids: number[] = [];
    const amounts: BigNumber[] = [];
    for (const b of bins) {
      const bal = await lbToken.balanceOf(wrappedLoan.address, b.id);
      if (bal.gt(0)) {
        ids.push(b.id);
        amounts.push(bal);
      }
    }

    await wrappedLoan.removeLiquidityTraderJoeV2(TJV2_ROUTER_V2_1, [
      TOKEN_ADDRESSES["AVAX"],
      TOKEN_ADDRESSES["USDC"],
      20,
      0,
      0,
      ids,
      amounts,
      Math.ceil(Date.now() / 1000) + 600,
    ]);

    const binsAfter = await wrappedLoan.getOwnedTraderJoeV2Bins();
    expect(binsAfter.length).to.equal(
      0,
      "Bins should be fully removed before invariant re-check"
    );

    const totalValue = await wrappedLoan.getTotalValue();
    const totalAssetsValue = await wrappedLoan.getTotalAssetsValue();
    const stakedValue = await wrappedLoan.getStakedValue();
    const tjv2Value = await wrappedLoan.getTotalTraderJoeV2();

    expect(tjv2Value).to.equal(0, "No bins → TJv2 sum must be 0");
    expect(totalValue).to.equal(
      totalAssetsValue.add(stakedValue).add(tjv2Value),
      "Invariant must hold trivially when there are no bins"
    );

    const solvency = await ethers.getContractAt(
      "SolvencyFacetMockAvalanche",
      wrappedLoan.address,
      owner
    );
    const wrappedSolvency = WrapperBuilder
      // @ts-ignore
      .wrap(solvency)
      .usingSimpleNumericMock({
        mockSignersCount: 10,
        dataPoints: MOCK_PRICES,
        timestampMilliseconds: Date.now(),
      });
    const cached = await wrappedSolvency.getAllPricesForLiquidation([]);
    expect(cached.tjv2TokenPrices.length).to.equal(
      0,
      "tjv2TokenPrices must be empty when there are no bins"
    );
  });
});
