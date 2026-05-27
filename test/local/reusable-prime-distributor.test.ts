import { ethers, waffle } from "hardhat";
import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Contract, BigNumber } from "ethers";
import { toWei } from "../_helpers";

import MockRtknToPrimeConverterArtifact from "../../artifacts/contracts/mock/MockRtknToPrimeConverter.sol/MockRtknToPrimeConverter.json";
import ReusablePrimeDistributorArtifact from "../../artifacts/contracts/ReusablePrimeDistributor.sol/ReusablePrimeDistributor.json";

chai.use(solidity);

const { deployContract } = waffle;

describe("ReusablePrimeDistributor", () => {
    let owner: SignerWithAddress,
        user1: SignerWithAddress,
        user2: SignerWithAddress,
        user3: SignerWithAddress,
        nonOwner: SignerWithAddress;

    let primeToken: Contract;
    let converter: Contract;
    let distributor: Contract;

    const CONVERSION_RATIO = BigNumber.from("808015513897867000"); // 0.808015513897867e18

    const user1Pledge = toWei("1000");
    const user2Pledge = toWei("2000");
    const user3Pledge = toWei("500");

    // Expected shares after conversion
    let user1Share: BigNumber;
    let user2Share: BigNumber;
    let user3Share: BigNumber;
    let totalShares: BigNumber;

    before("Deploy contracts", async () => {
        [owner, user1, user2, user3, nonOwner] = await ethers.getSigners();

        // Compute expected shares
        user1Share = user1Pledge.mul(CONVERSION_RATIO).div(toWei("1"));
        user2Share = user2Pledge.mul(CONVERSION_RATIO).div(toWei("1"));
        user3Share = user3Pledge.mul(CONVERSION_RATIO).div(toWei("1"));
        totalShares = user1Share.add(user2Share).add(user3Share);

        // Deploy mock converter
        converter = await deployContract(owner, MockRtknToPrimeConverterArtifact, []);
        await converter.addUser(user1.address, user1Pledge);
        await converter.addUser(user2.address, user2Pledge);
        await converter.addUser(user3.address, user3Pledge);

        // Deploy a simple ERC20 as PRIME mock using MockToken pattern
        // We'll use the ethers ContractFactory directly
        const MockTokenFactory = await ethers.getContractFactory("MockPrimeToken");
        primeToken = await MockTokenFactory.deploy(owner.address, toWei("1000000"));

        // Deploy distributor
        distributor = await deployContract(owner, ReusablePrimeDistributorArtifact, [
            primeToken.address,
            converter.address,
        ]);
    });

    describe("Initialization", () => {
        it("should set immutables correctly", async () => {
            expect(await distributor.primeToken()).to.equal(primeToken.address);
            expect(await distributor.rTKNConverter()).to.equal(converter.address);
        });

        it("should start with usersCached = false", async () => {
            expect(await distributor.usersCached()).to.equal(false);
        });

        it("should revert startRound before caching", async () => {
            await expect(distributor.startRound()).to.be.revertedWith("Users not cached yet");
        });
    });

    describe("Caching users", () => {
        it("should revert if non-owner calls cacheUsers", async () => {
            await expect(distributor.connect(nonOwner).cacheUsers(10)).to.be.revertedWith(
                "Ownable: caller is not the owner"
            );
        });

        it("should cache users in batches", async () => {
            // Cache first 2 users
            await distributor.cacheUsers(2);
            expect(await distributor.usersCached()).to.equal(false);

            let progress = await distributor.getCachingProgress();
            expect(progress.cached).to.equal(2);
            expect(progress.total).to.equal(3);

            // Cache remaining user
            await distributor.cacheUsers(10);
            expect(await distributor.usersCached()).to.equal(true);
            expect(await distributor.getTotalCachedUsers()).to.equal(3);
            expect(await distributor.totalShares()).to.equal(totalShares);
        });

        it("should revert if cacheUsers called again", async () => {
            await expect(distributor.cacheUsers(10)).to.be.revertedWith("Users already cached");
        });

        it("should have correct individual shares", async () => {
            expect(await distributor.userShare(user1.address)).to.equal(user1Share);
            expect(await distributor.userShare(user2.address)).to.equal(user2Share);
            expect(await distributor.userShare(user3.address)).to.equal(user3Share);
        });
    });

    describe("Distribution round 1", () => {
        const roundAmount = toWei("10000");

        it("should revert startRound with no PRIME balance", async () => {
            await expect(distributor.startRound()).to.be.revertedWith("No PRIME to distribute");
        });

        it("should start a round after funding", async () => {
            await primeToken.transfer(distributor.address, roundAmount);
            expect(await distributor.getCurrentPrimeBalance()).to.equal(roundAmount);

            await expect(distributor.startRound())
                .to.emit(distributor, "RoundStarted")
                .withArgs(1, roundAmount);

            expect(await distributor.currentRound()).to.equal(1);
            expect(await distributor.roundInProgress()).to.equal(true);
        });

        it("should revert starting another round while in progress", async () => {
            await expect(distributor.startRound()).to.be.revertedWith("Round already in progress");
        });

        it("should revert if non-owner calls distribute", async () => {
            await expect(distributor.connect(nonOwner).distribute(10)).to.be.revertedWith(
                "Ownable: caller is not the owner"
            );
        });

        it("should distribute proportionally", async () => {
            await distributor.distribute(10);

            expect(await distributor.roundInProgress()).to.equal(false);
            expect(await distributor.currentRound()).to.equal(1);

            const user1Expected = roundAmount.mul(user1Share).div(totalShares);
            const user2Expected = roundAmount.mul(user2Share).div(totalShares);
            const user3Expected = roundAmount.mul(user3Share).div(totalShares);

            expect(await primeToken.balanceOf(user1.address)).to.equal(user1Expected);
            expect(await primeToken.balanceOf(user2.address)).to.equal(user2Expected);
            expect(await primeToken.balanceOf(user3.address)).to.equal(user3Expected);

            expect(await distributor.userTotalReceived(user1.address)).to.equal(user1Expected);
            expect(await distributor.userTotalReceived(user2.address)).to.equal(user2Expected);
            expect(await distributor.userTotalReceived(user3.address)).to.equal(user3Expected);
        });

        it("should track total distributed", async () => {
            const total = await distributor.totalPrimeDistributed();
            expect(total).to.be.gt(0);
        });
    });

    describe("Distribution round 2", () => {
        const roundAmount = toWei("5000");

        it("should allow a second round", async () => {
            await primeToken.transfer(distributor.address, roundAmount);

            // Account for dust from round 1
            const contractBalance = await primeToken.balanceOf(distributor.address);

            await distributor.startRound();
            expect(await distributor.currentRound()).to.equal(2);
            expect(await distributor.roundPrimeAmount()).to.equal(contractBalance);

            await distributor.distribute(10);
            expect(await distributor.roundInProgress()).to.equal(false);
        });

        it("should accumulate userTotalReceived across rounds", async () => {
            const user1Total = await distributor.userTotalReceived(user1.address);
            expect(user1Total).to.be.gt(0);
            // user1 should have received from both rounds
            const user1Balance = await primeToken.balanceOf(user1.address);
            expect(user1Balance).to.equal(user1Total);
        });
    });

    describe("Batched distribution", () => {
        const roundAmount = toWei("3000");

        it("should support distributing in multiple batches", async () => {
            await primeToken.transfer(distributor.address, roundAmount);
            const contractBalance = await primeToken.balanceOf(distributor.address);

            await distributor.startRound();

            // Distribute 1 user at a time
            await distributor.distribute(1);
            let progress = await distributor.getRoundProgress();
            expect(progress.distributed).to.equal(1);
            expect(await distributor.roundInProgress()).to.equal(true);

            await distributor.distribute(1);
            progress = await distributor.getRoundProgress();
            expect(progress.distributed).to.equal(2);
            expect(await distributor.roundInProgress()).to.equal(true);

            await distributor.distribute(1);
            expect(await distributor.roundInProgress()).to.equal(false);
        });
    });

    describe("Emergency withdraw", () => {
        it("should allow emergency withdraw when no round in progress", async () => {
            const amount = toWei("1000");
            await primeToken.transfer(distributor.address, amount);

            await expect(distributor.emergencyWithdraw(primeToken.address, owner.address))
                .to.emit(distributor, "EmergencyWithdraw");
        });

        it("should reset round state if called mid-round", async () => {
            const amount = toWei("1000");
            await primeToken.transfer(distributor.address, amount);

            await distributor.startRound();
            expect(await distributor.roundInProgress()).to.equal(true);

            await distributor.emergencyWithdraw(primeToken.address, owner.address);
            expect(await distributor.roundInProgress()).to.equal(false);
        });

        it("should revert if non-owner calls", async () => {
            await expect(
                distributor.connect(nonOwner).emergencyWithdraw(primeToken.address, owner.address)
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });
    });

    describe("renounceOwnership", () => {
        it("should revert", async () => {
            await expect(distributor.renounceOwnership()).to.be.revertedWith(
                "Ownership renunciation disabled"
            );
        });
    });
});
