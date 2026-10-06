// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {WageholdStrongbox} from "../src/WageholdStrongbox.sol";
import {WageholdPatronage} from "../src/WageholdPatronage.sol";
import {WageholdSplitterV2} from "../src/WageholdSplitterV2.sol";
import {IWageholdPatronage} from "../src/interfaces/IWageholdPatronage.sol";
import {MockWAGE} from "./mocks/MockWAGE.sol";

contract WageholdSplitterV2Test is Test {
    WageholdStrongbox internal strongbox;
    WageholdPatronage internal patronage;
    WageholdSplitterV2 internal splitter;
    MockWAGE internal wage;

    address internal owner = makeAddr("owner");
    address internal council = makeAddr("council");
    address internal registrar = makeAddr("registrar");
    address internal client = makeAddr("client");
    address internal lampOil = makeAddr("lampOil");
    address internal tithe = makeAddr("tithe");
    address internal stranger = makeAddr("stranger");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    bytes32 internal constant AGENT = keccak256("agent-deepdive");
    bytes32 internal constant AGENT2 = keccak256("agent-gas-oracle");
    bytes32 internal constant JOB = keccak256("job-1");
    bytes32 internal constant JOB2 = keccak256("job-2");
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    uint256 internal constant ONE = 1e18;
    uint256 internal constant WAGE = 1_000e18; // splits 600 / 200 / 100 / 100

    function setUp() public {
        wage = new MockWAGE();
        strongbox = new WageholdStrongbox(wage, council, owner);
        // Patronage and Splitter v2 reference each other: Patronage first with no splitter...
        patronage = new WageholdPatronage(wage, owner, address(0), tithe, 7 days, 100e18, 5_000_000e18);
        splitter = new WageholdSplitterV2(
            wage, strongbox, IWageholdPatronage(address(patronage)), registrar, owner, lampOil, tithe
        );
        // ...then the owner points Patronage at the deployed Splitter.
        vm.startPrank(owner);
        patronage.setSplitter(address(splitter));
        patronage.registerBuilding(AGENT, true);
        patronage.registerBuilding(AGENT2, true);
        vm.stopPrank();

        wage.mint(client, 1_000_000e18);
        vm.prank(client);
        wage.approve(address(strongbox), type(uint256).max);

        address[2] memory patrons = [alice, bob];
        for (uint256 i; i < patrons.length; ++i) {
            wage.mint(patrons[i], 1_000_000e18);
            vm.prank(patrons[i]);
            wage.approve(address(patronage), type(uint256).max);
        }
    }

    // ------------------------------------------------------------------
    // helpers
    // ------------------------------------------------------------------

    /// Expected call order: client locks the wage, council points the payee at the Splitter,
    /// registrar binds the job to a building. Then the client's seal releases it.
    function _post(bytes32 jobId, bytes32 agentId, uint256 amount) internal {
        vm.prank(client);
        strongbox.createJob(jobId, amount);
        vm.prank(council);
        strongbox.setPayee(jobId, address(splitter));
        vm.prank(registrar);
        splitter.registerJob(jobId, agentId);
    }

    function _seal(bytes32 jobId) internal {
        vm.prank(client);
        strongbox.approve(jobId);
    }

    function _stake(address user, bytes32 agentId, uint256 amount) internal {
        vm.prank(user);
        patronage.stake(agentId, amount);
    }

    /// The Splitter's token balance must always equal what it still owes (pull-payments + burn).
    function _assertSplitterSolvent() internal view {
        assertEq(
            wage.balanceOf(address(splitter)),
            splitter.pendingWithdrawals(lampOil) + splitter.pendingWithdrawals(tithe)
                + splitter.pendingBurn()
        );
    }

    // ------------------------------------------------------------------
    // registerJob
    // ------------------------------------------------------------------

    function test_RegisterJob_StoresAgentAndEmits() public {
        vm.prank(client);
        strongbox.createJob(JOB, WAGE);
        vm.prank(council);
        strongbox.setPayee(JOB, address(splitter));

        vm.expectEmit(true, true, false, true, address(splitter));
        emit WageholdSplitterV2.JobRegistered(JOB, AGENT, WAGE);
        vm.prank(registrar);
        splitter.registerJob(JOB, AGENT);

        WageholdSplitterV2.SplitJob memory sj = splitter.getSplit(JOB);
        assertEq(sj.agentId, AGENT);
        assertEq(sj.amount, WAGE);
        assertFalse(sj.split);
    }

    function test_RegisterJob_OnlyRegistrar() public {
        vm.prank(client);
        strongbox.createJob(JOB, WAGE);
        vm.prank(council);
        strongbox.setPayee(JOB, address(splitter));

        vm.expectRevert(WageholdSplitterV2.NotRegistrar.selector);
        vm.prank(stranger);
        splitter.registerJob(JOB, AGENT);

        vm.expectRevert(WageholdSplitterV2.NotRegistrar.selector);
        vm.prank(council); // the Council key has no power here (H2)
        splitter.registerJob(JOB, AGENT);

        vm.expectRevert(WageholdSplitterV2.NotRegistrar.selector);
        vm.prank(owner);
        splitter.registerJob(JOB, AGENT);
    }

    function test_RegisterJob_RevertsOnUnregisteredBuildingOrZeroAgent() public {
        vm.prank(client);
        strongbox.createJob(JOB, WAGE);
        vm.prank(council);
        strongbox.setPayee(JOB, address(splitter));

        vm.startPrank(registrar);
        vm.expectRevert(WageholdSplitterV2.BuildingNotRegistered.selector);
        splitter.registerJob(JOB, keccak256("ghost"));
        vm.expectRevert(WageholdSplitterV2.ZeroAgentId.selector);
        splitter.registerJob(JOB, bytes32(0));
        vm.stopPrank();
    }

    function test_RegisterJob_RevertsOnPayeeMismatchDuplicateAndNotOpen() public {
        vm.prank(client);
        strongbox.createJob(JOB, WAGE);

        vm.expectRevert(WageholdSplitterV2.PayeeMismatch.selector); // payee not set yet
        vm.prank(registrar);
        splitter.registerJob(JOB, AGENT);

        vm.prank(council);
        strongbox.setPayee(JOB, makeAddr("someoneElse"));
        vm.expectRevert(WageholdSplitterV2.PayeeMismatch.selector); // wrong payee
        vm.prank(registrar);
        splitter.registerJob(JOB, AGENT);

        vm.prank(council);
        strongbox.setPayee(JOB, address(splitter));
        vm.prank(registrar);
        splitter.registerJob(JOB, AGENT);
        vm.expectRevert(WageholdSplitterV2.JobAlreadyRegistered.selector);
        vm.prank(registrar);
        splitter.registerJob(JOB, AGENT2);

        // a job that is already released can no longer be registered
        vm.prank(client);
        strongbox.createJob(JOB2, WAGE);
        vm.prank(council);
        strongbox.setPayee(JOB2, address(splitter));
        _seal(JOB2);
        vm.expectRevert(WageholdSplitterV2.JobNotOpenInStrongbox.selector);
        vm.prank(registrar);
        splitter.registerJob(JOB2, AGENT);
    }

    // ------------------------------------------------------------------
    // full flow: post job -> lock -> seal -> Splitter v2 -> Patronage -> patron claim
    // ------------------------------------------------------------------

    function test_FullFlow_SealedJobFeedsPatronsAndSplit() public {
        _stake(alice, AGENT, 3_000 * ONE);
        _stake(bob, AGENT, 1_000 * ONE);

        _post(JOB, AGENT, WAGE);
        assertEq(wage.balanceOf(address(strongbox)), WAGE); // locked in escrow

        _seal(JOB);

        uint256 patronageBefore = wage.balanceOf(address(patronage));
        vm.expectEmit(true, true, false, true, address(splitter));
        emit WageholdSplitterV2.JobSplit(JOB, AGENT, 600 * ONE, 200 * ONE, 100 * ONE, 100 * ONE);
        vm.prank(stranger); // permissionless
        splitter.pullAndSplit(JOB);

        // 60% reaches Patronage and is claimable pro rata: 3/4 and 1/4 of 600
        assertEq(wage.balanceOf(address(patronage)) - patronageBefore, 600 * ONE);
        assertEq(patronage.pendingRewards(AGENT, alice), 450 * ONE);
        assertEq(patronage.pendingRewards(AGENT, bob), 150 * ONE);

        // 10% burned, 20% / 10% waiting for the treasuries, nothing left in the Strongbox
        assertEq(wage.balanceOf(DEAD), 100 * ONE);
        assertEq(splitter.totalBurned(), 100 * ONE);
        assertEq(splitter.pendingBurn(), 0);
        assertEq(splitter.pendingWithdrawals(lampOil), 200 * ONE);
        assertEq(splitter.pendingWithdrawals(tithe), 100 * ONE);
        assertEq(wage.balanceOf(address(strongbox)), 0);
        _assertSplitterSolvent();

        // patrons claim, treasuries withdraw
        uint256 aliceBefore = wage.balanceOf(alice);
        vm.prank(alice);
        patronage.claim(AGENT);
        assertEq(wage.balanceOf(alice) - aliceBefore, 450 * ONE);

        vm.prank(lampOil);
        splitter.withdraw();
        vm.prank(tithe);
        splitter.withdraw();
        assertEq(wage.balanceOf(lampOil), 200 * ONE);
        assertEq(wage.balanceOf(tithe), 100 * ONE);
        assertEq(wage.balanceOf(address(splitter)), 0);

        // the whole wage is accounted for: 600 + 200 + 100 + 100
        assertEq(WAGE, 600 * ONE + 200 * ONE + 100 * ONE + 100 * ONE);
    }

    function test_FullFlow_NoStakers_RoutesPatronCutToTreasury() public {
        _post(JOB, AGENT, WAGE);
        _seal(JOB);

        vm.expectEmit(true, true, false, true, address(patronage));
        emit WageholdPatronage.RewardRedirected(AGENT, JOB, 600 * ONE, tithe);
        splitter.pullAndSplit(JOB);

        // tithe treasury received the 600 directly from Patronage; its 100 is still pull-payment
        assertEq(wage.balanceOf(tithe), 600 * ONE);
        assertEq(patronage.getPool(AGENT).redirectedTotal, 600 * ONE);
        assertEq(patronage.accountedBalance(), 0);
        assertEq(wage.balanceOf(address(patronage)), 0);
        assertEq(splitter.pendingWithdrawals(tithe), 100 * ONE);
        _assertSplitterSolvent();
    }

    function test_FullFlow_TwoBuildingsRouteToTheirOwnPatrons() public {
        _stake(alice, AGENT, 1_000 * ONE);
        _stake(bob, AGENT2, 1_000 * ONE);

        _post(JOB, AGENT, WAGE);
        _post(JOB2, AGENT2, 500 * ONE);
        _seal(JOB);
        _seal(JOB2);

        splitter.pullAndSplit(JOB2);
        splitter.pullAndSplit(JOB);

        assertEq(patronage.pendingRewards(AGENT, alice), 600 * ONE);
        assertEq(patronage.pendingRewards(AGENT2, bob), 300 * ONE);
        assertEq(patronage.pendingRewards(AGENT, bob), 0);
        assertEq(patronage.pendingRewards(AGENT2, alice), 0);
        _assertSplitterSolvent();
    }

    function test_FullFlow_PartialDisputeSplitsOnlyWhatWasReleased() public {
        _stake(alice, AGENT, 1_000 * ONE);
        _post(JOB, AGENT, WAGE);

        vm.prank(client);
        strongbox.dispute(JOB);
        vm.prank(council);
        strongbox.resolveDispute(JOB, 400 * ONE, 600 * ONE);

        splitter.pullAndSplit(JOB);

        // only the 400 awarded to the Wright is split: 240 / 80 / 40 / 40
        assertEq(patronage.pendingRewards(AGENT, alice), 240 * ONE);
        assertEq(splitter.pendingWithdrawals(lampOil), 80 * ONE);
        assertEq(splitter.pendingWithdrawals(tithe), 40 * ONE);
        assertEq(wage.balanceOf(DEAD), 40 * ONE);
        // the client's 600 refund is untouched in the Strongbox
        assertEq(strongbox.pendingWithdrawals(client), 600 * ONE);
        _assertSplitterSolvent();
    }

    function test_FullFlow_FullRefundDispute_SplitsNothingAndDoesNotRevert() public {
        _stake(alice, AGENT, 1_000 * ONE);
        _post(JOB, AGENT, WAGE);
        vm.prank(client);
        strongbox.dispute(JOB);
        vm.prank(council);
        strongbox.resolveDispute(JOB, 0, WAGE);

        splitter.pullAndSplit(JOB);

        assertTrue(splitter.getSplit(JOB).split);
        assertEq(patronage.pendingRewards(AGENT, alice), 0);
        assertEq(wage.balanceOf(DEAD), 0);
        _assertSplitterSolvent();
    }

    function test_FullFlow_BuildingUnregisteredAfterRegistration_StillPaysPatrons() public {
        _stake(alice, AGENT, 1_000 * ONE);
        _post(JOB, AGENT, WAGE);
        vm.prank(owner);
        patronage.registerBuilding(AGENT, false); // only blocks NEW stakes
        _seal(JOB);

        splitter.pullAndSplit(JOB);
        assertEq(patronage.pendingRewards(AGENT, alice), 600 * ONE);
    }

    // ------------------------------------------------------------------
    // pullAndSplit guards
    // ------------------------------------------------------------------

    function test_PullAndSplit_RevertsWhenNotRegisteredNotReleasedOrAlreadySplit() public {
        vm.expectRevert(WageholdSplitterV2.JobNotRegistered.selector);
        splitter.pullAndSplit(JOB);

        _post(JOB, AGENT, WAGE);
        vm.expectRevert(WageholdSplitterV2.JobNotReleasedYet.selector);
        splitter.pullAndSplit(JOB); // not sealed yet

        _seal(JOB);
        splitter.pullAndSplit(JOB);
        vm.expectRevert(WageholdSplitterV2.JobAlreadySplit.selector);
        splitter.pullAndSplit(JOB);
    }

    function test_PullAndSplit_RevertsWholeSplitIfPatronageRejectsNotify() public {
        _stake(alice, AGENT, 1_000 * ONE);
        _post(JOB, AGENT, WAGE);
        _seal(JOB);

        // Patronage no longer recognises this Splitter: nothing may be half-applied.
        vm.prank(owner);
        patronage.setSplitter(makeAddr("otherSplitter"));
        vm.expectRevert(WageholdPatronage.NotSplitter.selector);
        splitter.pullAndSplit(JOB);

        assertFalse(splitter.getSplit(JOB).split);
        assertEq(splitter.pendingWithdrawals(lampOil), 0);
        assertEq(wage.balanceOf(DEAD), 0);
        assertEq(strongbox.pendingWithdrawals(address(splitter)), WAGE); // still safe in Strongbox

        // once fixed, the same job goes through
        vm.prank(owner);
        patronage.setSplitter(address(splitter));
        splitter.pullAndSplit(JOB);
        assertEq(patronage.pendingRewards(AGENT, alice), 600 * ONE);
    }

    function test_PullAndSplit_BurnRefusedByTokenStillSplits() public {
        _stake(alice, AGENT, 1_000 * ONE);
        wage.setBlocked(DEAD, true);
        _post(JOB, AGENT, WAGE);
        _seal(JOB);

        splitter.pullAndSplit(JOB);
        assertEq(patronage.pendingRewards(AGENT, alice), 600 * ONE);
        assertEq(splitter.pendingBurn(), 100 * ONE);
        assertEq(splitter.totalBurned(), 0);
        _assertSplitterSolvent();

        vm.expectRevert(bytes("recipient blocked"));
        splitter.burn();

        wage.setBlocked(DEAD, false);
        splitter.burn();
        assertEq(wage.balanceOf(DEAD), 100 * ONE);
        assertEq(splitter.pendingBurn(), 0);
        _assertSplitterSolvent();
    }

    function test_PullAndSplit_TreasuryRefusingRedirectCannotBlockTheSplit() public {
        // Patronage's treasury refuses tokens, and the building has no stakers.
        wage.setBlocked(tithe, true);
        _post(JOB, AGENT, WAGE);
        _seal(JOB);

        splitter.pullAndSplit(JOB); // must not revert
        assertEq(patronage.pendingRedirect(), 600 * ONE);
        assertEq(splitter.pendingWithdrawals(lampOil), 200 * ONE);

        wage.setBlocked(tithe, false);
        patronage.flushRedirect();
        assertEq(wage.balanceOf(tithe), 600 * ONE);
    }

    function test_PullAndSplit_DustGoesToTitheAndEverythingAddsUp() public {
        // 1,001 wei: 60% = 600, 20% = 200, 10% burn = 100, tithe takes the 101 remainder.
        _stake(alice, AGENT, 1_000 * ONE);
        _post(JOB, AGENT, 1_001);
        _seal(JOB);
        splitter.pullAndSplit(JOB);

        assertEq(splitter.pendingWithdrawals(lampOil), 200);
        assertEq(splitter.pendingWithdrawals(tithe), 101);
        assertEq(wage.balanceOf(DEAD), 100);
        assertEq(patronage.pendingRewards(AGENT, alice), 600);
        _assertSplitterSolvent();
    }

    // ------------------------------------------------------------------
    // admin
    // ------------------------------------------------------------------

    function test_Admin_OnlyOwnerAndRegistrarRotation() public {
        vm.startPrank(stranger);
        vm.expectRevert(WageholdSplitterV2.NotOwner.selector);
        splitter.setRegistrar(stranger);
        vm.expectRevert(WageholdSplitterV2.NotOwner.selector);
        splitter.setLampOilTreasury(stranger);
        vm.expectRevert(WageholdSplitterV2.NotOwner.selector);
        splitter.setTitheTreasury(stranger);
        vm.expectRevert(WageholdSplitterV2.NotOwner.selector);
        splitter.transferOwnership(stranger);
        vm.stopPrank();

        address newRegistrar = makeAddr("newRegistrar");
        vm.prank(owner);
        splitter.setRegistrar(newRegistrar);

        vm.prank(client);
        strongbox.createJob(JOB, WAGE);
        vm.prank(council);
        strongbox.setPayee(JOB, address(splitter));

        vm.expectRevert(WageholdSplitterV2.NotRegistrar.selector); // old key is dead
        vm.prank(registrar);
        splitter.registerJob(JOB, AGENT);
        vm.prank(newRegistrar);
        splitter.registerJob(JOB, AGENT);
    }

    function test_Admin_TreasuryRotationAffectsOnlyFutureSplits() public {
        address newLamp = makeAddr("newLamp");
        vm.prank(owner);
        splitter.setLampOilTreasury(newLamp);
        _post(JOB, AGENT, WAGE);
        _seal(JOB);
        splitter.pullAndSplit(JOB);
        assertEq(splitter.pendingWithdrawals(newLamp), 200 * ONE);
        assertEq(splitter.pendingWithdrawals(lampOil), 0);

        vm.expectRevert(WageholdSplitterV2.ZeroAddress.selector);
        vm.prank(owner);
        splitter.setTitheTreasury(address(0));
    }

    function test_Ownership_TwoStep() public {
        vm.prank(owner);
        splitter.transferOwnership(alice);
        assertEq(splitter.owner(), owner);

        vm.expectRevert(WageholdSplitterV2.NotPendingOwner.selector);
        vm.prank(bob);
        splitter.acceptOwnership();

        vm.prank(alice);
        splitter.acceptOwnership();
        assertEq(splitter.owner(), alice);
    }

    function test_Constructor_RevertsOnZeroAddress() public {
        vm.expectRevert(WageholdSplitterV2.ZeroAddress.selector);
        new WageholdSplitterV2(
            wage, strongbox, IWageholdPatronage(address(0)), registrar, owner, lampOil, tithe
        );
        vm.expectRevert(WageholdSplitterV2.ZeroAddress.selector);
        new WageholdSplitterV2(
            wage, strongbox, IWageholdPatronage(address(patronage)), address(0), owner, lampOil, tithe
        );
    }
}
