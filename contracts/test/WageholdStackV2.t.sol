// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {WageholdStrongbox} from "../src/WageholdStrongbox.sol";
import {WageholdStrongboxV2} from "../src/WageholdStrongboxV2.sol";
import {WageholdPatronage} from "../src/WageholdPatronage.sol";
import {WageholdSplitterV2} from "../src/WageholdSplitterV2.sol";
import {WageholdTimelock} from "../src/WageholdTimelock.sol";
import {IWageholdPatronage} from "../src/interfaces/IWageholdPatronage.sol";
import {MockWAGE} from "./mocks/MockWAGE.sol";

/// @notice The production topology of the Patronage build: Safe -> Timelock -> {Strongbox v2,
/// Splitter v2, Patronage}, hot Registrar key, Council Safe, Guardian. Exercises H1-H4 end to end.
contract WageholdStackV2Test is Test {
    WageholdStrongboxV2 internal sb;
    WageholdPatronage internal patronage;
    WageholdSplitterV2 internal splitter;
    WageholdTimelock internal timelock;
    MockWAGE internal wage;

    address internal safe = makeAddr("safe"); // owner Safe: proposer + canceller on the timelock
    address internal councilSafe = makeAddr("councilSafe");
    address internal registrar = makeAddr("registrar"); // server hot key
    address internal guardian = makeAddr("guardian");
    address internal client = makeAddr("client");
    address internal lampOil = makeAddr("lampOil");
    address internal tithe = makeAddr("tithe");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal attacker = makeAddr("attacker");
    address internal anyone = makeAddr("anyone");

    bytes32 internal constant AGENT = keccak256("agent-deepdive");
    bytes32 internal constant AGENT_EMPTY = keccak256("agent-gas-oracle");
    bytes32 internal constant JOB = keccak256("job-1");
    bytes32 internal constant JOB2 = keccak256("job-2");
    uint256 internal constant DELAY = 48 hours;
    uint256 internal constant WAGE_AMT = 1_000e18; // 600 / 200 / 100 / 100

    function setUp() public {
        wage = new MockWAGE();

        address[] memory proposers = new address[](1);
        proposers[0] = safe;
        address[] memory executors = new address[](1);
        executors[0] = address(0); // anyone may execute once the delay has passed
        timelock = new WageholdTimelock(DELAY, proposers, executors, address(0));

        sb = new WageholdStrongboxV2(wage, councilSafe, registrar, address(timelock));
        patronage =
            new WageholdPatronage(wage, address(timelock), address(0), tithe, 7 days, 100e18, 5_000_000e18);
        splitter = new WageholdSplitterV2(
            wage,
            // Splitter v2 reads the Strongbox through the v1 ABI; v2 is ABI-identical for those calls.
            WageholdStrongbox(address(sb)),
            IWageholdPatronage(address(patronage)),
            registrar,
            address(timelock),
            lampOil,
            tithe
        );

        // The owner is the timelock, so wiring itself goes through the delay (as it would on mainnet).
        _viaTimelock(address(patronage), abi.encodeCall(patronage.setSplitter, (address(splitter))), "w1");
        _viaTimelock(address(patronage), abi.encodeCall(patronage.setGuardian, (guardian)), "w2");
        _viaTimelock(address(patronage), abi.encodeCall(patronage.registerBuilding, (AGENT, true)), "w3");
        _viaTimelock(
            address(patronage), abi.encodeCall(patronage.registerBuilding, (AGENT_EMPTY, true)), "w4"
        );
        _viaTimelock(address(sb), abi.encodeCall(sb.setAllowedPayee, (address(splitter), true)), "w5");

        wage.mint(client, 1_000_000e18);
        vm.prank(client);
        wage.approve(address(sb), type(uint256).max);

        address[2] memory patrons = [alice, bob];
        for (uint256 i; i < patrons.length; ++i) {
            wage.mint(patrons[i], 1_000_000e18);
            vm.prank(patrons[i]);
            wage.approve(address(patronage), type(uint256).max);
        }
    }

    function _viaTimelock(address target, bytes memory data, bytes32 salt) internal {
        vm.prank(safe);
        timelock.schedule(target, 0, data, bytes32(0), salt, DELAY);
        vm.warp(block.timestamp + DELAY);
        vm.prank(anyone);
        timelock.execute(target, 0, data, bytes32(0), salt);
    }

    function _post(bytes32 jobId, bytes32 agentId) internal {
        vm.prank(client);
        sb.createJob(jobId, WAGE_AMT);
        vm.startPrank(registrar);
        sb.setPayee(jobId, address(splitter));
        splitter.registerJob(jobId, agentId);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------
    // wiring / ownership topology
    // ------------------------------------------------------------------

    function test_Topology_OwnersAreTheTimelock() public view {
        assertEq(sb.owner(), address(timelock));
        assertEq(patronage.owner(), address(timelock));
        assertEq(splitter.owner(), address(timelock));
        assertEq(sb.council(), councilSafe);
        assertEq(sb.registrar(), registrar);
        assertEq(splitter.registrar(), registrar);
        assertEq(patronage.splitter(), address(splitter));
        assertTrue(sb.allowedPayee(address(splitter)));
    }

    // ------------------------------------------------------------------
    // H1 + H4: timelock
    // ------------------------------------------------------------------

    function test_Timelock_ConstructorRejectsDelayBelowFloor() public {
        address[] memory p = new address[](1);
        p[0] = safe;
        address[] memory e = new address[](1);
        e[0] = address(0);
        vm.expectRevert(abi.encodeWithSelector(WageholdTimelock.DelayBelowFloor.selector, 23 hours));
        new WageholdTimelock(23 hours, p, e, address(0));
    }

    function test_Timelock_ConfigChangeCannotRunBeforeDelay() public {
        bytes memory data = abi.encodeCall(patronage.setCooldown, (3 days));
        vm.prank(safe);
        timelock.schedule(address(patronage), 0, data, bytes32(0), "c1", DELAY);

        vm.warp(block.timestamp + DELAY - 1);
        vm.prank(anyone);
        vm.expectRevert();
        timelock.execute(address(patronage), 0, data, bytes32(0), "c1");
        assertEq(patronage.cooldown(), 7 days);

        vm.warp(block.timestamp + 1);
        vm.prank(anyone);
        timelock.execute(address(patronage), 0, data, bytes32(0), "c1");
        assertEq(patronage.cooldown(), 3 days);
    }

    function test_Timelock_ScheduleBelowFloorRejected() public {
        bytes memory data = abi.encodeCall(patronage.setCooldown, (3 days));
        vm.prank(safe);
        vm.expectRevert();
        timelock.schedule(address(patronage), 0, data, bytes32(0), "c2", 1 hours);
    }

    function test_Timelock_OnlyProposerCanSchedule_OnlyProposerCanCancel() public {
        bytes memory data = abi.encodeCall(patronage.setTreasury, (attacker));
        vm.prank(attacker);
        vm.expectRevert();
        timelock.schedule(address(patronage), 0, data, bytes32(0), "evil", DELAY);

        vm.prank(safe);
        timelock.schedule(address(patronage), 0, data, bytes32(0), "evil", DELAY);
        bytes32 id = timelock.hashOperation(address(patronage), 0, data, bytes32(0), "evil");

        vm.prank(attacker);
        vm.expectRevert();
        timelock.cancel(id);

        vm.prank(safe);
        timelock.cancel(id);

        vm.warp(block.timestamp + DELAY);
        vm.prank(anyone);
        vm.expectRevert();
        timelock.execute(address(patronage), 0, data, bytes32(0), "evil");
        assertEq(patronage.treasury(), tithe);
    }

    function test_Timelock_SafeCannotBypassDelayByCallingDirectly() public {
        vm.startPrank(safe);
        vm.expectRevert(WageholdPatronage.NotOwner.selector);
        patronage.setCooldown(3 days);
        vm.expectRevert(WageholdPatronage.NotOwner.selector);
        patronage.setSplitter(attacker);
        vm.expectRevert(WageholdSplitterV2.NotOwner.selector);
        splitter.setTitheTreasury(attacker);
        vm.expectRevert(WageholdStrongboxV2.NotOwner.selector);
        sb.setAllowedPayee(attacker, true);
        vm.stopPrank();
    }

    function test_Timelock_TreasuryChangeIsAnnouncedThenApplied() public {
        address newTithe = makeAddr("newTithe");
        _viaTimelock(address(splitter), abi.encodeCall(splitter.setTitheTreasury, (newTithe)), "t1");
        assertEq(splitter.titheTreasury(), newTithe);
    }

    // ------------------------------------------------------------------
    // H2 + H3: a leaked Registrar key
    // ------------------------------------------------------------------

    function test_LeakedRegistrar_CannotRedirectWageToItself() public {
        vm.prank(client);
        sb.createJob(JOB, WAGE_AMT);

        vm.startPrank(registrar);
        vm.expectRevert(WageholdStrongboxV2.PayeeNotAllowed.selector);
        sb.setPayee(JOB, registrar);
        vm.expectRevert(WageholdStrongboxV2.PayeeNotAllowed.selector);
        sb.setPayee(JOB, attacker);
        vm.stopPrank();
    }

    function test_LeakedRegistrar_CannotResolveDisputes() public {
        _post(JOB, AGENT);
        vm.prank(client);
        sb.dispute(JOB);

        vm.prank(registrar);
        vm.expectRevert(WageholdStrongboxV2.NotCouncil.selector);
        sb.resolveDispute(JOB, WAGE_AMT, 0);
    }

    function test_LeakedRegistrar_CannotRegisterUnknownBuilding() public {
        vm.prank(client);
        sb.createJob(JOB, WAGE_AMT);
        vm.startPrank(registrar);
        sb.setPayee(JOB, address(splitter));
        vm.expectRevert(WageholdSplitterV2.BuildingNotRegistered.selector);
        splitter.registerJob(JOB, keccak256("not-a-building"));
        vm.stopPrank();
    }

    function test_LeakedRegistrar_CannotTouchAdminSetters() public {
        vm.startPrank(registrar);
        vm.expectRevert(WageholdStrongboxV2.NotOwner.selector);
        sb.setRegistrar(attacker);
        vm.expectRevert(WageholdStrongboxV2.NotOwner.selector);
        sb.setAllowedPayee(attacker, true);
        vm.expectRevert(WageholdSplitterV2.NotOwner.selector);
        splitter.setRegistrar(attacker);
        vm.expectRevert(WageholdPatronage.NotOwner.selector);
        patronage.registerBuilding(keccak256("x"), true);
        vm.stopPrank();
    }

    function test_RegistrarRotation_ThroughTimelock() public {
        address newReg = makeAddr("newRegistrar");
        _viaTimelock(address(sb), abi.encodeCall(sb.setRegistrar, (newReg)), "r1");
        _viaTimelock(address(splitter), abi.encodeCall(splitter.setRegistrar, (newReg)), "r2");

        vm.prank(client);
        sb.createJob(JOB, WAGE_AMT);

        vm.prank(registrar);
        vm.expectRevert(WageholdStrongboxV2.NotRegistrar.selector);
        sb.setPayee(JOB, address(splitter));

        vm.startPrank(newReg);
        sb.setPayee(JOB, address(splitter));
        splitter.registerJob(JOB, AGENT);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------
    // Full flow on the production topology
    // ------------------------------------------------------------------

    function test_FullFlow_SealSplitPatronsClaim() public {
        vm.prank(alice);
        patronage.stake(AGENT, 3_000e18);
        vm.prank(bob);
        patronage.stake(AGENT, 1_000e18);

        _post(JOB, AGENT);
        vm.prank(client);
        sb.approve(JOB); // only the client's seal releases the wage

        vm.prank(anyone);
        splitter.pullAndSplit(JOB);

        // 60% patron cut: alice 3/4, bob 1/4 of 600
        assertApproxEqAbs(patronage.pendingRewards(AGENT, alice), 450e18, 1);
        assertApproxEqAbs(patronage.pendingRewards(AGENT, bob), 150e18, 1);
        assertEq(splitter.pendingWithdrawals(lampOil), 200e18);
        assertEq(splitter.pendingWithdrawals(tithe), 100e18);
        assertEq(splitter.totalBurned(), 100e18);

        uint256 before = wage.balanceOf(alice);
        vm.prank(alice);
        patronage.claim(AGENT);
        assertApproxEqAbs(wage.balanceOf(alice) - before, 450e18, 1);
    }

    function test_FullFlow_NoStakers_RedirectsToTreasury() public {
        _post(JOB2, AGENT_EMPTY);
        vm.prank(client);
        sb.approve(JOB2);

        uint256 titheBefore = wage.balanceOf(tithe);
        vm.prank(anyone);
        splitter.pullAndSplit(JOB2);

        assertEq(wage.balanceOf(tithe) - titheBefore, 600e18);
        assertEq(patronage.getPool(AGENT_EMPTY).redirectedTotal, 600e18);
    }

    function test_FullFlow_DisputeThenCouncilSplit_FeedsPatrons() public {
        vm.prank(alice);
        patronage.stake(AGENT, 1_000e18);

        _post(JOB, AGENT);
        vm.prank(client);
        sb.dispute(JOB);
        vm.prank(councilSafe);
        sb.resolveDispute(JOB, 500e18, 500e18);

        vm.prank(anyone);
        splitter.pullAndSplit(JOB);

        // splitter only sees the payee share (500): patron cut = 300
        assertApproxEqAbs(patronage.pendingRewards(AGENT, alice), 300e18, 1);
        assertEq(sb.pendingWithdrawals(client), 500e18);
    }

    // ------------------------------------------------------------------
    // Guardian: instant, stake-blocking-only pause even though the owner is slow
    // ------------------------------------------------------------------

    function test_Guardian_CanPauseInstantly_ButNotUnpause() public {
        vm.prank(guardian);
        patronage.pause();
        assertTrue(patronage.paused());

        vm.prank(guardian);
        vm.expectRevert(WageholdPatronage.NotOwner.selector);
        patronage.unpause();

        vm.prank(alice);
        vm.expectRevert();
        patronage.stake(AGENT, 1_000e18);
    }

    function test_Guardian_StrangerCannotPause() public {
        vm.prank(attacker);
        vm.expectRevert(WageholdPatronage.NotOwnerOrGuardian.selector);
        patronage.pause();
    }

    function test_Guardian_CannotChangeAnythingElse() public {
        vm.startPrank(guardian);
        vm.expectRevert(WageholdPatronage.NotOwner.selector);
        patronage.setGuardian(attacker);
        vm.expectRevert(WageholdPatronage.NotOwner.selector);
        patronage.setSplitter(attacker);
        vm.expectRevert(WageholdPatronage.NotOwner.selector);
        patronage.setTreasury(attacker);
        vm.stopPrank();
    }

    function test_Paused_ClaimAndWithdrawStillWork() public {
        vm.prank(alice);
        patronage.stake(AGENT, 1_000e18);
        _post(JOB, AGENT);
        vm.prank(client);
        sb.approve(JOB);
        vm.prank(anyone);
        splitter.pullAndSplit(JOB);

        vm.prank(alice);
        patronage.requestUnstake(AGENT, 400e18);

        vm.prank(guardian);
        patronage.pause();

        vm.prank(alice);
        patronage.claim(AGENT);

        vm.warp(block.timestamp + 7 days);
        vm.prank(alice);
        patronage.withdraw(AGENT);
    }

    // ------------------------------------------------------------------
    // Charter: no admin path to staked $WAGE
    // ------------------------------------------------------------------

    function test_TimelockCannotRescueWageToken() public {
        vm.prank(alice);
        patronage.stake(AGENT, 1_000e18);

        bytes memory data =
            abi.encodeCall(patronage.rescueToken, (wage, attacker, 1_000e18));
        vm.prank(safe);
        timelock.schedule(address(patronage), 0, data, bytes32(0), "rescue", DELAY);
        vm.warp(block.timestamp + DELAY);
        vm.prank(anyone);
        vm.expectRevert(); // TimelockController wraps the inner revert (CannotRescueWageToken)
        timelock.execute(address(patronage), 0, data, bytes32(0), "rescue");

        assertEq(wage.balanceOf(address(patronage)), 1_000e18);
    }

    // ------------------------------------------------------------------
    // v1 -> v2 coexistence: v1 jobs finish on v1, nothing is force-migrated
    // ------------------------------------------------------------------

    function test_V1StrongboxJobsAreIndependentOfV2() public {
        WageholdStrongbox v1 = new WageholdStrongbox(wage, makeAddr("council-v1"), makeAddr("owner-v1"));
        vm.prank(client);
        wage.approve(address(v1), type(uint256).max);
        vm.prank(client);
        v1.createJob(keccak256("old-job"), 100e18);

        // Strongbox v2 knows nothing about it, and Splitter v2 cannot register it.
        assertEq(uint8(sb.getJob(keccak256("old-job")).status), 0);
        vm.prank(registrar);
        vm.expectRevert();
        splitter.registerJob(keccak256("old-job"), AGENT);
    }
}
