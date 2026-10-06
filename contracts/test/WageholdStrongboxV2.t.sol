// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {WageholdStrongboxV2} from "../src/WageholdStrongboxV2.sol";
import {MockWAGE} from "./mocks/MockWAGE.sol";

contract WageholdStrongboxV2Test is Test {
    WageholdStrongboxV2 internal sb;
    MockWAGE internal wage;

    address internal owner = makeAddr("owner");
    address internal council = makeAddr("council");
    address internal registrar = makeAddr("registrar");
    address internal client = makeAddr("client");
    address internal splitter = makeAddr("splitter"); // stands in for Splitter v2
    address internal attacker = makeAddr("attacker");
    address internal stranger = makeAddr("stranger");

    bytes32 internal constant JOB = keccak256("job-1");
    uint256 internal constant WAGE = 1_000e18;

    function setUp() public {
        wage = new MockWAGE();
        sb = new WageholdStrongboxV2(wage, council, registrar, owner);

        vm.prank(owner);
        sb.setAllowedPayee(splitter, true);

        wage.mint(client, 1_000_000e18);
        vm.prank(client);
        wage.approve(address(sb), type(uint256).max);
    }

    function _post() internal {
        vm.prank(client);
        sb.createJob(JOB, WAGE);
    }

    function _postAssigned() internal {
        _post();
        vm.prank(registrar);
        sb.setPayee(JOB, splitter);
    }

    // ------------------------------------------------------------------
    // constructor
    // ------------------------------------------------------------------

    function test_Constructor_RevertsOnZeroAddress() public {
        vm.expectRevert(WageholdStrongboxV2.ZeroAddress.selector);
        new WageholdStrongboxV2(wage, address(0), registrar, owner);
        vm.expectRevert(WageholdStrongboxV2.ZeroAddress.selector);
        new WageholdStrongboxV2(wage, council, address(0), owner);
        vm.expectRevert(WageholdStrongboxV2.ZeroAddress.selector);
        new WageholdStrongboxV2(wage, council, registrar, address(0));
    }

    function test_Constructor_RevertsWhenCouncilIsRegistrar() public {
        vm.expectRevert(WageholdStrongboxV2.CouncilIsRegistrar.selector);
        new WageholdStrongboxV2(wage, council, council, owner);
    }

    // ------------------------------------------------------------------
    // H2: role separation
    // ------------------------------------------------------------------

    function test_SetPayee_OnlyRegistrar() public {
        _post();
        address[3] memory callers = [council, owner, stranger];
        for (uint256 i; i < callers.length; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert(WageholdStrongboxV2.NotRegistrar.selector);
            sb.setPayee(JOB, splitter);
        }
    }

    function test_ResolveDispute_RegistrarCannot() public {
        _postAssigned();
        vm.prank(client);
        sb.dispute(JOB);

        vm.prank(registrar);
        vm.expectRevert(WageholdStrongboxV2.NotCouncil.selector);
        sb.resolveDispute(JOB, WAGE, 0);
    }

    function test_ResolveDispute_OwnerCannot() public {
        _postAssigned();
        vm.prank(client);
        sb.dispute(JOB);

        vm.prank(owner);
        vm.expectRevert(WageholdStrongboxV2.NotCouncil.selector);
        sb.resolveDispute(JOB, WAGE, 0);
    }

    // ------------------------------------------------------------------
    // H3: payee allow-list
    // ------------------------------------------------------------------

    function test_SetPayee_RevertsForAddressNotAllowed() public {
        _post();
        vm.prank(registrar);
        vm.expectRevert(WageholdStrongboxV2.PayeeNotAllowed.selector);
        sb.setPayee(JOB, attacker);
    }

    function test_SetPayee_AllowedPayeeWorks_AndEmits() public {
        _post();
        vm.expectEmit(true, true, false, true, address(sb));
        emit WageholdStrongboxV2.PayeeSet(JOB, splitter);
        vm.prank(registrar);
        sb.setPayee(JOB, splitter);

        assertEq(sb.getJob(JOB).payee, splitter);
    }

    function test_SetPayee_ZeroAddressReverts() public {
        _post();
        vm.prank(registrar);
        vm.expectRevert(WageholdStrongboxV2.ZeroAddress.selector);
        sb.setPayee(JOB, address(0));
    }

    function test_SetPayee_RevertsIfNotOpenOrMissing() public {
        vm.prank(registrar);
        vm.expectRevert(WageholdStrongboxV2.JobNotFound.selector);
        sb.setPayee(JOB, splitter);

        _postAssigned();
        vm.prank(client);
        sb.approve(JOB);

        vm.prank(registrar);
        vm.expectRevert(WageholdStrongboxV2.InvalidStatus.selector);
        sb.setPayee(JOB, splitter);
    }

    function test_SetPayee_CanRepointOnlyAmongAllowed() public {
        address splitter2 = makeAddr("splitter2");
        vm.prank(owner);
        sb.setAllowedPayee(splitter2, true);

        _postAssigned();
        vm.prank(registrar);
        sb.setPayee(JOB, splitter2);
        assertEq(sb.getJob(JOB).payee, splitter2);

        vm.prank(registrar);
        vm.expectRevert(WageholdStrongboxV2.PayeeNotAllowed.selector);
        sb.setPayee(JOB, attacker);
        assertEq(sb.getJob(JOB).payee, splitter2);
    }

    function test_RemovingFromAllowList_BlocksFutureButKeepsExisting() public {
        _postAssigned();
        vm.prank(owner);
        sb.setAllowedPayee(splitter, false);

        // existing assignment is untouched and the seal still pays it
        assertEq(sb.getJob(JOB).payee, splitter);
        vm.prank(client);
        sb.approve(JOB);
        assertEq(sb.pendingWithdrawals(splitter), WAGE);

        // but a new job can no longer be pointed at it
        bytes32 job2 = keccak256("job-2");
        vm.prank(client);
        sb.createJob(job2, WAGE);
        vm.prank(registrar);
        vm.expectRevert(WageholdStrongboxV2.PayeeNotAllowed.selector);
        sb.setPayee(job2, splitter);
    }

    function test_SetAllowedPayee_OnlyOwner_AndNonZero() public {
        vm.prank(registrar);
        vm.expectRevert(WageholdStrongboxV2.NotOwner.selector);
        sb.setAllowedPayee(attacker, true);

        vm.prank(council);
        vm.expectRevert(WageholdStrongboxV2.NotOwner.selector);
        sb.setAllowedPayee(attacker, true);

        vm.prank(owner);
        vm.expectRevert(WageholdStrongboxV2.ZeroAddress.selector);
        sb.setAllowedPayee(address(0), true);
    }

    // ------------------------------------------------------------------
    // lifecycle (same behaviour as v1)
    // ------------------------------------------------------------------

    function test_CreateJob_LocksFunds() public {
        _post();
        assertEq(wage.balanceOf(address(sb)), WAGE);
        WageholdStrongboxV2.Job memory job = sb.getJob(JOB);
        assertEq(job.client, client);
        assertEq(job.amount, WAGE);
        assertEq(uint8(job.status), uint8(WageholdStrongboxV2.Status.Open));
    }

    function test_CreateJob_RevertsOnZeroAndDuplicate() public {
        vm.prank(client);
        vm.expectRevert(WageholdStrongboxV2.ZeroAmount.selector);
        sb.createJob(JOB, 0);

        _post();
        vm.prank(client);
        vm.expectRevert(WageholdStrongboxV2.JobAlreadyExists.selector);
        sb.createJob(JOB, WAGE);
    }

    function test_Approve_OnlyClient_AndNeedsPayee() public {
        _post();
        vm.prank(client);
        vm.expectRevert(WageholdStrongboxV2.PayeeNotSet.selector);
        sb.approve(JOB);

        vm.prank(registrar);
        sb.setPayee(JOB, splitter);

        address[4] memory callers = [registrar, council, owner, splitter];
        for (uint256 i; i < callers.length; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert(WageholdStrongboxV2.NotClient.selector);
            sb.approve(JOB);
        }
    }

    function test_Approve_CreditsPayee_AndWithdrawPays() public {
        _postAssigned();
        vm.prank(client);
        sb.approve(JOB);

        assertEq(sb.releasedToPayee(JOB), WAGE);
        assertEq(sb.pendingWithdrawals(splitter), WAGE);

        vm.prank(splitter);
        sb.withdraw();
        assertEq(wage.balanceOf(splitter), WAGE);
        assertEq(wage.balanceOf(address(sb)), 0);

        vm.prank(splitter);
        vm.expectRevert(WageholdStrongboxV2.NothingToWithdraw.selector);
        sb.withdraw();
    }

    function test_Refund_OnlyBeforePayee() public {
        _post();
        vm.prank(client);
        sb.refund(JOB);
        assertEq(sb.pendingWithdrawals(client), WAGE);

        bytes32 job2 = keccak256("job-2");
        vm.prank(client);
        sb.createJob(job2, WAGE);
        vm.prank(registrar);
        sb.setPayee(job2, splitter);
        vm.prank(client);
        vm.expectRevert(WageholdStrongboxV2.PayeeAlreadySet.selector);
        sb.refund(job2);
    }

    function test_Dispute_OnlyClient() public {
        _postAssigned();
        vm.prank(stranger);
        vm.expectRevert(WageholdStrongboxV2.NotClient.selector);
        sb.dispute(JOB);

        vm.prank(client);
        sb.dispute(JOB);
        assertEq(uint8(sb.getJob(JOB).status), uint8(WageholdStrongboxV2.Status.Disputed));
    }

    // ------------------------------------------------------------------
    // resolveDispute
    // ------------------------------------------------------------------

    function test_ResolveDispute_SplitsBetweenPayeeAndClient() public {
        _postAssigned();
        vm.prank(client);
        sb.dispute(JOB);

        vm.prank(council);
        sb.resolveDispute(JOB, 400e18, 600e18);

        assertEq(sb.releasedToPayee(JOB), 400e18);
        assertEq(sb.pendingWithdrawals(splitter), 400e18);
        assertEq(sb.pendingWithdrawals(client), 600e18);
        assertEq(uint8(sb.getJob(JOB).status), uint8(WageholdStrongboxV2.Status.Released));
    }

    function test_ResolveDispute_RevertsOnSplitMismatch() public {
        _postAssigned();
        vm.prank(client);
        sb.dispute(JOB);

        vm.prank(council);
        vm.expectRevert(WageholdStrongboxV2.SplitMismatch.selector);
        sb.resolveDispute(JOB, 400e18, 599e18);
    }

    function test_ResolveDispute_RevertsIfNotDisputed() public {
        _postAssigned();
        vm.prank(council);
        vm.expectRevert(WageholdStrongboxV2.InvalidStatus.selector);
        sb.resolveDispute(JOB, WAGE, 0);
    }

    function test_ResolveDispute_NoPayee_OnlyFullRefund() public {
        _post();
        vm.prank(client);
        sb.dispute(JOB);

        vm.prank(council);
        vm.expectRevert(WageholdStrongboxV2.PayeeNotSet.selector);
        sb.resolveDispute(JOB, 1, WAGE - 1);

        vm.prank(council);
        sb.resolveDispute(JOB, 0, WAGE);
        assertEq(sb.pendingWithdrawals(client), WAGE);
    }

    function testFuzz_ResolveDispute_ConservesAmount(uint96 amount, uint96 toPayee) public {
        vm.assume(amount > 0);
        uint256 payeeAmount = uint256(toPayee) % (uint256(amount) + 1);
        uint256 refundAmount = uint256(amount) - payeeAmount;

        wage.mint(client, amount);
        bytes32 jobId = keccak256(abi.encode("fuzz", amount, toPayee));
        vm.prank(client);
        sb.createJob(jobId, amount);
        vm.prank(registrar);
        sb.setPayee(jobId, splitter);
        vm.prank(client);
        sb.dispute(jobId);

        vm.prank(council);
        sb.resolveDispute(jobId, payeeAmount, refundAmount);

        assertEq(sb.pendingWithdrawals(splitter) + sb.pendingWithdrawals(client), amount);
        assertEq(sb.releasedToPayee(jobId), payeeAmount);
    }

    // ------------------------------------------------------------------
    // owner / role rotation
    // ------------------------------------------------------------------

    function test_SetCouncil_And_SetRegistrar_OnlyOwner() public {
        vm.prank(council);
        vm.expectRevert(WageholdStrongboxV2.NotOwner.selector);
        sb.setCouncil(stranger);
        vm.prank(registrar);
        vm.expectRevert(WageholdStrongboxV2.NotOwner.selector);
        sb.setRegistrar(stranger);

        vm.startPrank(owner);
        sb.setCouncil(stranger);
        sb.setRegistrar(attacker);
        vm.stopPrank();
        assertEq(sb.council(), stranger);
        assertEq(sb.registrar(), attacker);
    }

    function test_RoleRotation_CannotMakeCouncilEqualRegistrar() public {
        vm.startPrank(owner);
        vm.expectRevert(WageholdStrongboxV2.CouncilIsRegistrar.selector);
        sb.setCouncil(registrar);
        vm.expectRevert(WageholdStrongboxV2.CouncilIsRegistrar.selector);
        sb.setRegistrar(council);
        vm.expectRevert(WageholdStrongboxV2.ZeroAddress.selector);
        sb.setCouncil(address(0));
        vm.expectRevert(WageholdStrongboxV2.ZeroAddress.selector);
        sb.setRegistrar(address(0));
        vm.stopPrank();
    }

    function test_RotatedRegistrar_OldKeyLosesPower() public {
        _post();
        vm.prank(owner);
        sb.setRegistrar(stranger);

        vm.prank(registrar);
        vm.expectRevert(WageholdStrongboxV2.NotRegistrar.selector);
        sb.setPayee(JOB, splitter);

        vm.prank(stranger);
        sb.setPayee(JOB, splitter);
    }

    function test_Ownership_TwoStep() public {
        address newOwner = makeAddr("newOwner");

        vm.prank(stranger);
        vm.expectRevert(WageholdStrongboxV2.NotOwner.selector);
        sb.transferOwnership(newOwner);

        vm.prank(owner);
        sb.transferOwnership(newOwner);
        assertEq(sb.owner(), owner); // not yet

        vm.prank(stranger);
        vm.expectRevert(WageholdStrongboxV2.NotPendingOwner.selector);
        sb.acceptOwnership();

        vm.prank(newOwner);
        sb.acceptOwnership();
        assertEq(sb.owner(), newOwner);
        assertEq(sb.pendingOwner(), address(0));
    }

    /// No admin role can pull escrowed funds out: the only token movers are client-seal/refund
    /// (credit pull-payments to the job's own parties) and resolveDispute (same).
    function test_NoRoleCanWithdrawOthersFunds() public {
        _postAssigned();
        address[3] memory roles = [owner, council, registrar];
        for (uint256 i; i < roles.length; ++i) {
            vm.prank(roles[i]);
            vm.expectRevert(WageholdStrongboxV2.NothingToWithdraw.selector);
            sb.withdraw();
        }
        assertEq(wage.balanceOf(address(sb)), WAGE);
    }
}
