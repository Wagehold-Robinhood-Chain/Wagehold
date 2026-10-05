// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {WageholdStrongbox} from "../src/WageholdStrongbox.sol";
import {WageholdSplitter} from "../src/WageholdSplitter.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {BlockableToken} from "./mocks/BlockableToken.sol";

contract WageholdSplitterTest is Test {
    WageholdStrongbox internal strongbox;
    WageholdSplitter internal splitter;
    MockUSDC internal token;

    address internal owner = makeAddr("owner");
    address internal council = makeAddr("council");
    address internal client = makeAddr("client");
    address internal patronPool = makeAddr("patronPool");
    address internal lampOilTreasury = makeAddr("lampOilTreasury");
    address internal titheTreasury = makeAddr("titheTreasury");
    address internal stranger = makeAddr("stranger");

    bytes32 internal constant JOB_ID = keccak256("job-1");
    bytes32 internal constant JOB_ID_2 = keccak256("job-2");
    uint256 internal constant WAGE = 1_000e6; // 1,000 mUSDC -- splits evenly (600/200/100/100)
    uint256 internal constant CLIENT_BALANCE = 100_000e6;

    function setUp() public {
        token = new MockUSDC();
        strongbox = new WageholdStrongbox(token, council, owner);
        splitter =
            new WageholdSplitter(token, strongbox, council, owner, lampOilTreasury, titheTreasury);

        token.mint(client, CLIENT_BALANCE);
        vm.prank(client);
        token.approve(address(strongbox), type(uint256).max);
    }

    // ------------------------------------------------------------------
    // helpers
    // ------------------------------------------------------------------

    /// @dev Takes a job all the way to `Released` with the Splitter as payee, mirroring the
    /// expected call order documented on `WageholdSplitter`.
    function _fundAssignAndApprove(bytes32 jobId, uint256 amount) internal {
        vm.prank(client);
        strongbox.createJob(jobId, amount);

        vm.prank(council);
        strongbox.setPayee(jobId, address(splitter));

        vm.prank(client);
        strongbox.approve(jobId);
    }

    // ------------------------------------------------------------------
    // registerJob
    // ------------------------------------------------------------------

    function test_RegisterJob_StoresSnapshotAndEmits() public {
        vm.prank(client);
        strongbox.createJob(JOB_ID, WAGE);
        vm.prank(council);
        strongbox.setPayee(JOB_ID, address(splitter));

        vm.expectEmit(true, true, false, true, address(splitter));
        emit WageholdSplitter.JobRegistered(JOB_ID, patronPool, WAGE);

        vm.prank(council);
        splitter.registerJob(JOB_ID, patronPool);

        WageholdSplitter.SplitJob memory sj = splitter.getSplit(JOB_ID);
        assertEq(sj.patronPool, patronPool);
        assertEq(sj.amount, WAGE);
        assertFalse(sj.split);
    }

    function test_RegisterJob_OnlyCouncil() public {
        vm.prank(client);
        strongbox.createJob(JOB_ID, WAGE);
        vm.prank(council);
        strongbox.setPayee(JOB_ID, address(splitter));

        vm.expectRevert(WageholdSplitter.NotCouncil.selector);
        vm.prank(stranger);
        splitter.registerJob(JOB_ID, patronPool);
    }

    function test_RegisterJob_RevertsOnZeroPatronPool() public {
        vm.prank(client);
        strongbox.createJob(JOB_ID, WAGE);
        vm.prank(council);
        strongbox.setPayee(JOB_ID, address(splitter));

        vm.expectRevert(WageholdSplitter.ZeroAddress.selector);
        vm.prank(council);
        splitter.registerJob(JOB_ID, address(0));
    }

    function test_RegisterJob_RevertsIfJobNotOpen() public {
        // Never created -- status is None, not Open.
        vm.expectRevert(WageholdSplitter.JobNotOpenInStrongbox.selector);
        vm.prank(council);
        splitter.registerJob(JOB_ID, patronPool);
    }

    function test_RegisterJob_RevertsIfPayeeIsNotThisSplitter() public {
        vm.prank(client);
        strongbox.createJob(JOB_ID, WAGE);
        // Payee left unset (address(0)) -- not this Splitter.

        vm.expectRevert(WageholdSplitter.PayeeMismatch.selector);
        vm.prank(council);
        splitter.registerJob(JOB_ID, patronPool);
    }

    function test_RegisterJob_RevertsOnDoubleRegistration() public {
        vm.prank(client);
        strongbox.createJob(JOB_ID, WAGE);
        vm.prank(council);
        strongbox.setPayee(JOB_ID, address(splitter));

        vm.startPrank(council);
        splitter.registerJob(JOB_ID, patronPool);
        vm.expectRevert(WageholdSplitter.JobAlreadyRegistered.selector);
        splitter.registerJob(JOB_ID, patronPool);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------
    // pullAndSplit
    // ------------------------------------------------------------------

    function test_PullAndSplit_CreditsAllFourParts() public {
        vm.prank(client);
        strongbox.createJob(JOB_ID, WAGE);
        vm.prank(council);
        strongbox.setPayee(JOB_ID, address(splitter));
        vm.prank(council);
        splitter.registerJob(JOB_ID, patronPool);
        vm.prank(client);
        strongbox.approve(JOB_ID);

        uint256 expectedPatron = (WAGE * 6_000) / 10_000; // 600e6
        uint256 expectedLampOil = (WAGE * 2_000) / 10_000; // 200e6
        uint256 expectedBurn = (WAGE * 1_000) / 10_000; // 100e6
        uint256 expectedTithe = WAGE - expectedPatron - expectedLampOil - expectedBurn; // 100e6

        vm.expectEmit(true, true, false, true, address(splitter));
        emit WageholdSplitter.JobSplit(
            JOB_ID, patronPool, expectedPatron, expectedLampOil, expectedTithe, expectedBurn
        );

        splitter.pullAndSplit(JOB_ID); // permissionless -- called by nobody in particular

        assertEq(splitter.pendingWithdrawals(patronPool), expectedPatron);
        assertEq(splitter.pendingWithdrawals(lampOilTreasury), expectedLampOil);
        assertEq(splitter.pendingWithdrawals(titheTreasury), expectedTithe);
        // The Furnace share is burned in the same transaction: nothing left pending.
        assertEq(splitter.pendingBurn(), 0);
        assertEq(splitter.totalBurned(), expectedBurn);
        assertEq(token.balanceOf(splitter.BURN_ADDRESS()), expectedBurn);

        // The rest has actually left the Strongbox and sits in the Splitter, waiting to be
        // withdrawn by each destination.
        assertEq(token.balanceOf(address(strongbox)), 0);
        assertEq(token.balanceOf(address(splitter)), WAGE - expectedBurn);
        assertEq(strongbox.pendingWithdrawals(address(splitter)), 0);

        WageholdSplitter.SplitJob memory sj = splitter.getSplit(JOB_ID);
        assertTrue(sj.split);
    }

    function test_PullAndSplit_RevertsIfNotRegistered() public {
        _fundAssignAndApprove(JOB_ID, WAGE);

        vm.expectRevert(WageholdSplitter.JobNotRegistered.selector);
        splitter.pullAndSplit(JOB_ID);
    }

    function test_PullAndSplit_RevertsIfNotYetReleased() public {
        vm.prank(client);
        strongbox.createJob(JOB_ID, WAGE);
        vm.prank(council);
        strongbox.setPayee(JOB_ID, address(splitter));
        vm.prank(council);
        splitter.registerJob(JOB_ID, patronPool);
        // Client never calls approve() -- job stays Open, not Released.

        vm.expectRevert(WageholdSplitter.JobNotReleasedYet.selector);
        splitter.pullAndSplit(JOB_ID);
    }

    function test_PullAndSplit_RevertsOnDoubleSplit() public {
        vm.prank(client);
        strongbox.createJob(JOB_ID, WAGE);
        vm.prank(council);
        strongbox.setPayee(JOB_ID, address(splitter));
        vm.prank(council);
        splitter.registerJob(JOB_ID, patronPool);
        vm.prank(client);
        strongbox.approve(JOB_ID);

        splitter.pullAndSplit(JOB_ID);
        vm.expectRevert(WageholdSplitter.JobAlreadySplit.selector);
        splitter.pullAndSplit(JOB_ID);
    }

    /// @notice Two jobs approved back-to-back before either is split: the first `pullAndSplit`
    /// call pulls the Strongbox's *entire* pending balance (covering both jobs) into the
    /// Splitter, and the second call must not try to pull again (Strongbox would revert on a
    /// zero balance) -- it should just use the Splitter's own token balance.
    function test_PullAndSplit_HandlesTwoJobsPulledTogether() public {
        vm.startPrank(client);
        strongbox.createJob(JOB_ID, WAGE);
        strongbox.createJob(JOB_ID_2, WAGE);
        vm.stopPrank();

        vm.startPrank(council);
        strongbox.setPayee(JOB_ID, address(splitter));
        strongbox.setPayee(JOB_ID_2, address(splitter));
        splitter.registerJob(JOB_ID, patronPool);
        splitter.registerJob(JOB_ID_2, patronPool);
        vm.stopPrank();

        vm.startPrank(client);
        strongbox.approve(JOB_ID);
        strongbox.approve(JOB_ID_2);
        vm.stopPrank();

        // Strongbox now holds one combined pending balance of 2 * WAGE for the Splitter.
        assertEq(strongbox.pendingWithdrawals(address(splitter)), 2 * WAGE);

        splitter.pullAndSplit(JOB_ID); // pulls the full 2 * WAGE into the Splitter
        assertEq(strongbox.pendingWithdrawals(address(splitter)), 0);
        // 2 * WAGE arrived; job 1's Furnace share (10%) was burned straight away.
        assertEq(token.balanceOf(address(splitter)), 2 * WAGE - (WAGE * 1_000) / 10_000);

        splitter.pullAndSplit(JOB_ID_2); // must not revert trying to pull an already-empty balance

        uint256 expectedPatronPerJob = (WAGE * 6_000) / 10_000;
        assertEq(splitter.pendingBurn(), 0);
        assertEq(splitter.totalBurned(), 2 * ((WAGE * 1_000) / 10_000));
        assertEq(splitter.pendingWithdrawals(patronPool), 2 * expectedPatronPerJob);
    }

    function test_PullAndSplit_RevertsIfPayeeChangedAfterRegistration() public {
        vm.prank(client);
        strongbox.createJob(JOB_ID, WAGE);
        vm.prank(council);
        strongbox.setPayee(JOB_ID, address(splitter));
        vm.prank(council);
        splitter.registerJob(JOB_ID, patronPool);

        // Council reassigns the job to a different payee before it's approved -- allowed by
        // WageholdStrongbox.setPayee while the job is still Open.
        address otherPayee = makeAddr("otherPayee");
        vm.prank(council);
        strongbox.setPayee(JOB_ID, otherPayee);

        vm.prank(client);
        strongbox.approve(JOB_ID); // credits otherPayee, not the Splitter

        vm.expectRevert(WageholdSplitter.PayeeChangedSinceRegistration.selector);
        splitter.pullAndSplit(JOB_ID);
    }

    /// @notice Fuzzes odd amounts to prove the split always accounts for every base unit --
    /// rounding dust from integer division always lands with the Tithe, nothing is ever
    /// stranded in the Splitter or double-counted.
    function testFuzz_PullAndSplit_SplitAlwaysSumsToAmount(uint96 amount) public {
        vm.assume(amount > 0);
        token.mint(client, amount);

        vm.startPrank(client);
        token.approve(address(strongbox), amount);
        strongbox.createJob(JOB_ID, amount);
        vm.stopPrank();

        vm.startPrank(council);
        strongbox.setPayee(JOB_ID, address(splitter));
        splitter.registerJob(JOB_ID, patronPool);
        vm.stopPrank();

        vm.prank(client);
        strongbox.approve(JOB_ID);

        splitter.pullAndSplit(JOB_ID);

        uint256 total = splitter.pendingWithdrawals(patronPool)
            + splitter.pendingWithdrawals(lampOilTreasury) + splitter.pendingWithdrawals(titheTreasury)
            + splitter.pendingBurn() + splitter.totalBurned();
        assertEq(total, amount);
        // The Splitter holds exactly what it still owes: nothing stranded, nothing owed twice.
        assertEq(token.balanceOf(address(splitter)), amount - splitter.totalBurned());
        assertEq(token.balanceOf(splitter.BURN_ADDRESS()), splitter.totalBurned());
    }

    // ------------------------------------------------------------------
    // withdraw
    // ------------------------------------------------------------------

    function test_Withdraw_PatronPoolReceivesItsShare() public {
        vm.prank(client);
        strongbox.createJob(JOB_ID, WAGE);
        vm.prank(council);
        strongbox.setPayee(JOB_ID, address(splitter));
        vm.prank(council);
        splitter.registerJob(JOB_ID, patronPool);
        vm.prank(client);
        strongbox.approve(JOB_ID);
        splitter.pullAndSplit(JOB_ID);

        uint256 expectedPatron = (WAGE * 6_000) / 10_000;

        vm.prank(patronPool);
        splitter.withdraw();

        assertEq(token.balanceOf(patronPool), expectedPatron);
        assertEq(splitter.pendingWithdrawals(patronPool), 0);
    }

    function test_Withdraw_LampOilAndTitheReceiveTheirShares() public {
        vm.prank(client);
        strongbox.createJob(JOB_ID, WAGE);
        vm.prank(council);
        strongbox.setPayee(JOB_ID, address(splitter));
        vm.prank(council);
        splitter.registerJob(JOB_ID, patronPool);
        vm.prank(client);
        strongbox.approve(JOB_ID);
        splitter.pullAndSplit(JOB_ID);

        uint256 expectedLampOil = (WAGE * 2_000) / 10_000;
        uint256 expectedTithe =
            WAGE - (WAGE * 6_000) / 10_000 - expectedLampOil - (WAGE * 1_000) / 10_000;

        vm.prank(lampOilTreasury);
        splitter.withdraw();
        vm.prank(titheTreasury);
        splitter.withdraw();

        assertEq(token.balanceOf(lampOilTreasury), expectedLampOil);
        assertEq(token.balanceOf(titheTreasury), expectedTithe);
    }

    function test_Withdraw_RevertsWithNothingPending() public {
        vm.expectRevert(WageholdSplitter.NothingToWithdraw.selector);
        vm.prank(stranger);
        splitter.withdraw();
    }

    // ------------------------------------------------------------------
    // burn (Furnace)
    // ------------------------------------------------------------------

    function _splitOneJob() internal {
        vm.prank(client);
        strongbox.createJob(JOB_ID, WAGE);
        vm.prank(council);
        strongbox.setPayee(JOB_ID, address(splitter));
        vm.prank(council);
        splitter.registerJob(JOB_ID, patronPool);
        vm.prank(client);
        strongbox.approve(JOB_ID);
        splitter.pullAndSplit(JOB_ID);
    }

    function test_Burn_IsAutomaticOnPullAndSplit() public {
        uint256 expectedBurn = (WAGE * 1_000) / 10_000; // 100e6
        address dead = splitter.BURN_ADDRESS();

        vm.prank(client);
        strongbox.createJob(JOB_ID, WAGE);
        vm.prank(council);
        strongbox.setPayee(JOB_ID, address(splitter));
        vm.prank(council);
        splitter.registerJob(JOB_ID, patronPool);
        vm.prank(client);
        strongbox.approve(JOB_ID);

        vm.expectEmit(true, false, false, true, address(splitter));
        emit WageholdSplitter.Burned(stranger, expectedBurn);
        vm.prank(stranger);
        splitter.pullAndSplit(JOB_ID);

        assertEq(token.balanceOf(dead), expectedBurn);
        assertEq(splitter.pendingBurn(), 0);
        assertEq(splitter.totalBurned(), expectedBurn);
        assertEq(token.balanceOf(address(splitter)), WAGE - expectedBurn);
    }

    function test_Burn_ManualRevertsWithNothingToBurn() public {
        vm.expectRevert(WageholdSplitter.NothingToBurn.selector);
        splitter.burn();

        _splitOneJob(); // the automatic burn already emptied pendingBurn
        vm.expectRevert(WageholdSplitter.NothingToBurn.selector);
        splitter.burn();
    }

    function test_Burn_AccumulatesAcrossJobs() public {
        _splitOneJob();

        vm.prank(client);
        strongbox.createJob(JOB_ID_2, WAGE);
        vm.startPrank(council);
        strongbox.setPayee(JOB_ID_2, address(splitter));
        splitter.registerJob(JOB_ID_2, patronPool);
        vm.stopPrank();
        vm.prank(client);
        strongbox.approve(JOB_ID_2);
        splitter.pullAndSplit(JOB_ID_2);

        assertEq(splitter.totalBurned(), 2 * ((WAGE * 1_000) / 10_000));
        assertEq(splitter.pendingBurn(), 0);
    }

    /// @notice If the token refuses the burn transfer, the split still succeeds, the Furnace
    /// share stays booked, and a later manual `burn()` finishes the job once the token allows it.
    function test_Burn_TokenRefusal_DoesNotBlockSplit_ManualBurnRecovers() public {
        BlockableToken bt = new BlockableToken();
        WageholdStrongbox sb2 = new WageholdStrongbox(bt, council, owner);
        WageholdSplitter sp2 =
            new WageholdSplitter(bt, sb2, council, owner, lampOilTreasury, titheTreasury);
        address dead = sp2.BURN_ADDRESS();
        bt.setBlock(dead, true);

        bt.mint(client, WAGE);
        vm.prank(client);
        bt.approve(address(sb2), type(uint256).max);
        vm.prank(client);
        sb2.createJob(JOB_ID, WAGE);
        vm.startPrank(council);
        sb2.setPayee(JOB_ID, address(sp2));
        sp2.registerJob(JOB_ID, patronPool);
        vm.stopPrank();
        vm.prank(client);
        sb2.approve(JOB_ID);

        sp2.pullAndSplit(JOB_ID); // must not revert even though the burn transfer is refused

        uint256 expectedBurn = (WAGE * 1_000) / 10_000;
        assertEq(sp2.pendingBurn(), expectedBurn);
        assertEq(sp2.totalBurned(), 0);
        assertEq(bt.balanceOf(address(sp2)), WAGE); // everything still backed
        assertEq(sp2.pendingWithdrawals(patronPool), (WAGE * 6_000) / 10_000);

        vm.expectRevert(); // manual burn also reverts while the token still refuses
        sp2.burn();

        bt.setBlock(dead, false);
        sp2.burn();
        assertEq(bt.balanceOf(dead), expectedBurn);
        assertEq(sp2.pendingBurn(), 0);
        assertEq(sp2.totalBurned(), expectedBurn);
    }

    // ------------------------------------------------------------------
    // S5: partial / full-refund disputes must stay solvent
    // ------------------------------------------------------------------

    function _fundAssignRegister(bytes32 jobId, uint256 amount) internal {
        vm.prank(client);
        strongbox.createJob(jobId, amount);
        vm.startPrank(council);
        strongbox.setPayee(jobId, address(splitter));
        splitter.registerJob(jobId, patronPool);
        vm.stopPrank();
    }

    function test_S5_PartialDispute_SplitsOnlyWhatWasReleased() public {
        _fundAssignRegister(JOB_ID, WAGE);

        vm.prank(client);
        strongbox.dispute(JOB_ID);
        uint256 payeeShare = 600e6;
        vm.prank(council);
        strongbox.resolveDispute(JOB_ID, payeeShare, WAGE - payeeShare);

        assertEq(strongbox.releasedToPayee(JOB_ID), payeeShare);

        splitter.pullAndSplit(JOB_ID);

        // 60/20/10/10 of 600, not of the original 1,000.
        assertEq(splitter.pendingWithdrawals(patronPool), 360e6);
        assertEq(splitter.pendingWithdrawals(lampOilTreasury), 120e6);
        assertEq(splitter.pendingWithdrawals(titheTreasury), 60e6);
        assertEq(splitter.totalBurned(), 60e6);
        // Solvent: the Splitter holds exactly what it still owes.
        assertEq(token.balanceOf(address(splitter)), 360e6 + 120e6 + 60e6);

        vm.prank(patronPool);
        splitter.withdraw(); // used to revert before the fix (ledger said 700, balance was 600)
        assertEq(token.balanceOf(patronPool), 360e6);

        // The client's 400 refund share is untouched and withdrawable from the Strongbox.
        vm.prank(client);
        strongbox.withdraw();
        assertEq(token.balanceOf(client), CLIENT_BALANCE - WAGE + (WAGE - payeeShare));
    }

    function test_S5_FullRefundDispute_CreditsNothing() public {
        _fundAssignRegister(JOB_ID, WAGE);

        vm.prank(client);
        strongbox.dispute(JOB_ID);
        vm.prank(council);
        strongbox.resolveDispute(JOB_ID, 0, WAGE);

        assertEq(strongbox.releasedToPayee(JOB_ID), 0);

        splitter.pullAndSplit(JOB_ID); // succeeds with zero credits instead of inventing a wage

        assertEq(splitter.pendingWithdrawals(patronPool), 0);
        assertEq(splitter.pendingWithdrawals(lampOilTreasury), 0);
        assertEq(splitter.pendingWithdrawals(titheTreasury), 0);
        assertEq(splitter.pendingBurn(), 0);
        assertEq(splitter.totalBurned(), 0);
        assertEq(token.balanceOf(address(splitter)), 0);
        assertTrue(splitter.getSplit(JOB_ID).split);
    }

    /// @notice The scenario the finding warned about: a short job must not be paid out of a
    /// healthy job's tokens in a Splitter that holds several jobs at once.
    function test_S5_PartialDispute_DoesNotDrainOtherJobs() public {
        _fundAssignRegister(JOB_ID, WAGE);
        _fundAssignRegister(JOB_ID_2, WAGE);

        vm.prank(client);
        strongbox.dispute(JOB_ID);
        vm.prank(council);
        strongbox.resolveDispute(JOB_ID, 600e6, 400e6);
        vm.prank(client);
        strongbox.approve(JOB_ID_2);

        splitter.pullAndSplit(JOB_ID);
        splitter.pullAndSplit(JOB_ID_2);

        uint256 owed = splitter.pendingWithdrawals(patronPool)
            + splitter.pendingWithdrawals(lampOilTreasury) + splitter.pendingWithdrawals(titheTreasury);
        assertEq(owed, 600e6 + WAGE - splitter.totalBurned());
        assertEq(token.balanceOf(address(splitter)), owed);

        vm.prank(patronPool);
        splitter.withdraw();
        vm.prank(lampOilTreasury);
        splitter.withdraw();
        vm.prank(titheTreasury);
        splitter.withdraw();
        assertEq(token.balanceOf(address(splitter)), 0); // every last unit paid out, none short
    }

    function test_Constants_SumToDenominator() public view {
        assertEq(
            splitter.PATRON_BPS() + splitter.LAMP_OIL_BPS() + splitter.TITHE_BPS()
                + splitter.FURNACE_BPS(),
            splitter.BPS_DENOM()
        );
    }

    // ------------------------------------------------------------------
    // admin
    // ------------------------------------------------------------------

    function test_SetCouncil_OnlyOwner() public {
        vm.expectRevert(WageholdSplitter.NotOwner.selector);
        vm.prank(stranger);
        splitter.setCouncil(stranger);

        vm.prank(owner);
        splitter.setCouncil(stranger);
        assertEq(splitter.council(), stranger);
    }

    function test_SetOwner_OnlyOwner() public {
        vm.expectRevert(WageholdSplitter.NotOwner.selector);
        vm.prank(stranger);
        splitter.setOwner(stranger);

        vm.prank(owner);
        splitter.setOwner(stranger);
        assertEq(splitter.owner(), stranger);
    }

    function test_SetLampOilTreasury_OnlyOwner() public {
        vm.expectRevert(WageholdSplitter.NotOwner.selector);
        vm.prank(stranger);
        splitter.setLampOilTreasury(stranger);

        vm.prank(owner);
        splitter.setLampOilTreasury(stranger);
        assertEq(splitter.lampOilTreasury(), stranger);
    }

    function test_SetTitheTreasury_OnlyOwner() public {
        vm.expectRevert(WageholdSplitter.NotOwner.selector);
        vm.prank(stranger);
        splitter.setTitheTreasury(stranger);

        vm.prank(owner);
        splitter.setTitheTreasury(stranger);
        assertEq(splitter.titheTreasury(), stranger);
    }

    function test_AdminSetters_RevertOnZeroAddress() public {
        vm.startPrank(owner);
        vm.expectRevert(WageholdSplitter.ZeroAddress.selector);
        splitter.setCouncil(address(0));

        vm.expectRevert(WageholdSplitter.ZeroAddress.selector);
        splitter.setOwner(address(0));

        vm.expectRevert(WageholdSplitter.ZeroAddress.selector);
        splitter.setLampOilTreasury(address(0));

        vm.expectRevert(WageholdSplitter.ZeroAddress.selector);
        splitter.setTitheTreasury(address(0));
        vm.stopPrank();
    }

    function test_Constructor_RevertsOnZeroAddress() public {
        vm.expectRevert(WageholdSplitter.ZeroAddress.selector);
        new WageholdSplitter(
            token, strongbox, address(0), owner, lampOilTreasury, titheTreasury
        );

        vm.expectRevert(WageholdSplitter.ZeroAddress.selector);
        new WageholdSplitter(
            token, strongbox, council, address(0), lampOilTreasury, titheTreasury
        );

        vm.expectRevert(WageholdSplitter.ZeroAddress.selector);
        new WageholdSplitter(token, strongbox, council, owner, address(0), titheTreasury);

        vm.expectRevert(WageholdSplitter.ZeroAddress.selector);
        new WageholdSplitter(token, strongbox, council, owner, lampOilTreasury, address(0));
    }
}
