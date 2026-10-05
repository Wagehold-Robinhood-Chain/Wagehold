// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {WageholdStrongbox} from "../src/WageholdStrongbox.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract WageholdStrongboxTest is Test {
    WageholdStrongbox internal strongbox;
    MockUSDC internal token;

    address internal owner = makeAddr("owner");
    address internal council = makeAddr("council");
    address internal client = makeAddr("client");
    address internal payee = makeAddr("payee");
    address internal stranger = makeAddr("stranger");

    bytes32 internal constant JOB_ID = keccak256("job-1");
    uint256 internal constant WAGE = 500e6; // 500 mUSDC (6 decimals)
    uint256 internal constant CLIENT_BALANCE = 10_000e6;

    function setUp() public {
        token = new MockUSDC();
        strongbox = new WageholdStrongbox(token, council, owner);

        token.mint(client, CLIENT_BALANCE);
        vm.prank(client);
        token.approve(address(strongbox), type(uint256).max);
    }

    // ------------------------------------------------------------------
    // createJob
    // ------------------------------------------------------------------

    function test_CreateJob_LocksFundsAndEmits() public {
        vm.expectEmit(true, true, false, true, address(strongbox));
        emit WageholdStrongbox.JobFunded(JOB_ID, client, WAGE);

        vm.prank(client);
        strongbox.createJob(JOB_ID, WAGE);

        WageholdStrongbox.Job memory job = strongbox.getJob(JOB_ID);
        assertEq(job.client, client);
        assertEq(job.payee, address(0));
        assertEq(job.amount, WAGE);
        assertEq(uint8(job.status), uint8(WageholdStrongbox.Status.Open));

        assertEq(token.balanceOf(address(strongbox)), WAGE);
        assertEq(token.balanceOf(client), CLIENT_BALANCE - WAGE);
    }

    function test_CreateJob_RevertsOnZeroAmount() public {
        vm.prank(client);
        vm.expectRevert(WageholdStrongbox.ZeroAmount.selector);
        strongbox.createJob(JOB_ID, 0);
    }

    function test_CreateJob_RevertsOnDuplicateId() public {
        vm.startPrank(client);
        strongbox.createJob(JOB_ID, WAGE);
        vm.expectRevert(WageholdStrongbox.JobAlreadyExists.selector);
        strongbox.createJob(JOB_ID, WAGE);
        vm.stopPrank();
    }

    function testFuzz_CreateJob_ArbitraryAmount(uint96 amount) public {
        vm.assume(amount > 0);
        token.mint(client, amount);

        vm.startPrank(client);
        token.approve(address(strongbox), amount);
        strongbox.createJob(JOB_ID, amount);
        vm.stopPrank();

        assertEq(strongbox.getJob(JOB_ID).amount, amount);
        assertEq(token.balanceOf(address(strongbox)), amount);
    }

    // ------------------------------------------------------------------
    // setPayee
    // ------------------------------------------------------------------

    function test_SetPayee_OnlyCouncil() public {
        _createJob();

        vm.prank(stranger);
        vm.expectRevert(WageholdStrongbox.NotCouncil.selector);
        strongbox.setPayee(JOB_ID, payee);

        vm.expectEmit(true, true, false, false, address(strongbox));
        emit WageholdStrongbox.PayeeSet(JOB_ID, payee);
        vm.prank(council);
        strongbox.setPayee(JOB_ID, payee);

        assertEq(strongbox.getJob(JOB_ID).payee, payee);
    }

    function test_SetPayee_RevertsOnZeroAddress() public {
        _createJob();
        vm.prank(council);
        vm.expectRevert(WageholdStrongbox.ZeroAddress.selector);
        strongbox.setPayee(JOB_ID, address(0));
    }

    function test_SetPayee_RevertsIfJobNotFound() public {
        vm.prank(council);
        vm.expectRevert(WageholdStrongbox.JobNotFound.selector);
        strongbox.setPayee(JOB_ID, payee);
    }

    function test_SetPayee_RevertsIfNotOpen() public {
        _createJobAndAssign();
        vm.prank(client);
        strongbox.approve(JOB_ID);

        vm.prank(council);
        vm.expectRevert(WageholdStrongbox.InvalidStatus.selector);
        strongbox.setPayee(JOB_ID, payee);
    }

    // ------------------------------------------------------------------
    // approve ("Set the seal")
    // ------------------------------------------------------------------

    function test_Approve_RevertsIfNotClient() public {
        _createJobAndAssign();
        vm.prank(stranger);
        vm.expectRevert(WageholdStrongbox.NotClient.selector);
        strongbox.approve(JOB_ID);
    }

    function test_Approve_RevertsIfPayeeNotSet() public {
        _createJob();
        vm.prank(client);
        vm.expectRevert(WageholdStrongbox.PayeeNotSet.selector);
        strongbox.approve(JOB_ID);
    }

    function test_Approve_CreditsPayee_AndWithdrawSendsTokens() public {
        _createJobAndAssign();

        vm.expectEmit(true, true, false, true, address(strongbox));
        emit WageholdStrongbox.SealSet(JOB_ID, payee, WAGE);
        vm.prank(client);
        strongbox.approve(JOB_ID);

        assertEq(uint8(strongbox.getJob(JOB_ID).status), uint8(WageholdStrongbox.Status.Released));
        assertEq(strongbox.pendingWithdrawals(payee), WAGE);

        vm.prank(payee);
        strongbox.withdraw();

        assertEq(token.balanceOf(payee), WAGE);
        assertEq(strongbox.pendingWithdrawals(payee), 0);
        assertEq(token.balanceOf(address(strongbox)), 0);
    }

    function test_Approve_RevertsIfAlreadyReleased() public {
        _createJobAndAssign();
        vm.startPrank(client);
        strongbox.approve(JOB_ID);
        vm.expectRevert(WageholdStrongbox.InvalidStatus.selector);
        strongbox.approve(JOB_ID);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------
    // refund
    // ------------------------------------------------------------------

    function test_Refund_OnlyBeforePayeeSet() public {
        _createJob();

        vm.expectEmit(true, true, false, true, address(strongbox));
        emit WageholdStrongbox.JobRefunded(JOB_ID, client, WAGE);
        vm.prank(client);
        strongbox.refund(JOB_ID);

        assertEq(uint8(strongbox.getJob(JOB_ID).status), uint8(WageholdStrongbox.Status.Refunded));
        assertEq(strongbox.pendingWithdrawals(client), WAGE);

        vm.prank(client);
        strongbox.withdraw();
        assertEq(token.balanceOf(client), CLIENT_BALANCE);
    }

    function test_Refund_RevertsIfPayeeAlreadySet() public {
        _createJobAndAssign();
        vm.prank(client);
        vm.expectRevert(WageholdStrongbox.PayeeAlreadySet.selector);
        strongbox.refund(JOB_ID);
    }

    function test_Refund_RevertsIfNotClient() public {
        _createJob();
        vm.prank(stranger);
        vm.expectRevert(WageholdStrongbox.NotClient.selector);
        strongbox.refund(JOB_ID);
    }

    // ------------------------------------------------------------------
    // dispute + resolveDispute
    // ------------------------------------------------------------------

    function test_Dispute_OnlyClient() public {
        _createJobAndAssign();

        vm.prank(payee);
        vm.expectRevert(WageholdStrongbox.NotClient.selector);
        strongbox.dispute(JOB_ID);

        vm.expectEmit(true, true, false, false, address(strongbox));
        emit WageholdStrongbox.SealBroken(JOB_ID, client);
        vm.prank(client);
        strongbox.dispute(JOB_ID);

        assertEq(uint8(strongbox.getJob(JOB_ID).status), uint8(WageholdStrongbox.Status.Disputed));
    }

    function test_ReleasedToPayee_IsZeroUntilReleased() public {
        _createJobAndAssign();
        assertEq(strongbox.releasedToPayee(JOB_ID), 0);
    }

    function test_ReleasedToPayee_FullWageOnApprove() public {
        _createJobAndAssign();
        vm.prank(client);
        strongbox.approve(JOB_ID);
        assertEq(strongbox.releasedToPayee(JOB_ID), WAGE);
    }

    function test_ReleasedToPayee_OnlyPayeeShareOnResolveDispute() public {
        _createJobAndAssign();
        vm.prank(client);
        strongbox.dispute(JOB_ID);
        uint256 payeeShare = (WAGE * 60) / 100;
        vm.prank(council);
        strongbox.resolveDispute(JOB_ID, payeeShare, WAGE - payeeShare);
        assertEq(strongbox.releasedToPayee(JOB_ID), payeeShare);
    }

    function test_ReleasedToPayee_ZeroOnFullRefundDispute() public {
        _createJobAndAssign();
        vm.prank(client);
        strongbox.dispute(JOB_ID);
        vm.prank(council);
        strongbox.resolveDispute(JOB_ID, 0, WAGE);
        assertEq(strongbox.releasedToPayee(JOB_ID), 0);
    }

    function test_ResolveDispute_SplitsCorrectly() public {
        _createJobAndAssign();
        vm.prank(client);
        strongbox.dispute(JOB_ID);

        uint256 payeeShare = (WAGE * 60) / 100;
        uint256 refundShare = WAGE - payeeShare;

        vm.expectEmit(true, true, false, true, address(strongbox));
        emit WageholdStrongbox.DisputeResolved(JOB_ID, payee, payeeShare, refundShare);
        vm.prank(council);
        strongbox.resolveDispute(JOB_ID, payeeShare, refundShare);

        assertEq(strongbox.pendingWithdrawals(payee), payeeShare);
        assertEq(strongbox.pendingWithdrawals(client), refundShare);
        assertEq(uint8(strongbox.getJob(JOB_ID).status), uint8(WageholdStrongbox.Status.Released));

        vm.prank(payee);
        strongbox.withdraw();
        vm.prank(client);
        strongbox.withdraw();

        assertEq(token.balanceOf(payee), payeeShare);
        assertEq(token.balanceOf(client), CLIENT_BALANCE - WAGE + refundShare);
    }

    function test_ResolveDispute_RevertsOnSplitMismatch() public {
        _createJobAndAssign();
        vm.prank(client);
        strongbox.dispute(JOB_ID);

        vm.prank(council);
        vm.expectRevert(WageholdStrongbox.SplitMismatch.selector);
        strongbox.resolveDispute(JOB_ID, WAGE, 1);
    }

    function test_ResolveDispute_OnlyCouncil() public {
        _createJobAndAssign();
        vm.prank(client);
        strongbox.dispute(JOB_ID);

        vm.prank(stranger);
        vm.expectRevert(WageholdStrongbox.NotCouncil.selector);
        strongbox.resolveDispute(JOB_ID, WAGE, 0);
    }

    function test_ResolveDispute_RevertsIfNotDisputed() public {
        _createJobAndAssign();
        vm.prank(council);
        vm.expectRevert(WageholdStrongbox.InvalidStatus.selector);
        strongbox.resolveDispute(JOB_ID, WAGE, 0);
    }

    // ------------------------------------------------------------------
    // withdraw
    // ------------------------------------------------------------------

    function test_Withdraw_RevertsWithNothingPending() public {
        vm.prank(stranger);
        vm.expectRevert(WageholdStrongbox.NothingToWithdraw.selector);
        strongbox.withdraw();
    }

    // ------------------------------------------------------------------
    // admin
    // ------------------------------------------------------------------

    function test_SetCouncil_OnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(WageholdStrongbox.NotOwner.selector);
        strongbox.setCouncil(stranger);

        vm.prank(owner);
        strongbox.setCouncil(stranger);
        assertEq(strongbox.council(), stranger);
    }

    function test_SetOwner_OnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(WageholdStrongbox.NotOwner.selector);
        strongbox.setOwner(stranger);

        vm.prank(owner);
        strongbox.setOwner(stranger);
        assertEq(strongbox.owner(), stranger);
    }

    function test_Constructor_RevertsOnZeroAddress() public {
        vm.expectRevert(WageholdStrongbox.ZeroAddress.selector);
        new WageholdStrongbox(token, address(0), owner);

        vm.expectRevert(WageholdStrongbox.ZeroAddress.selector);
        new WageholdStrongbox(token, council, address(0));
    }

    // ------------------------------------------------------------------
    // helpers
    // ------------------------------------------------------------------

    function _createJob() internal {
        vm.prank(client);
        strongbox.createJob(JOB_ID, WAGE);
    }

    function _createJobAndAssign() internal {
        _createJob();
        vm.prank(council);
        strongbox.setPayee(JOB_ID, payee);
    }
}
