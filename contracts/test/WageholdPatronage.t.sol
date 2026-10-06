// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {WageholdPatronage} from "../src/WageholdPatronage.sol";
import {MockWAGE} from "./mocks/MockWAGE.sol";
import {FeeToken} from "./mocks/FeeToken.sol";
import {ReentrancyHookToken, PatronageReentrancyAttacker} from "./mocks/ReentrancyHookToken.sol";

contract WageholdPatronageTest is Test {
    WageholdPatronage internal patronage;
    MockWAGE internal wage;

    address internal owner = makeAddr("owner");
    address internal splitter = makeAddr("splitter");
    address internal treasury = makeAddr("treasury");
    address internal stranger = makeAddr("stranger");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal dave = makeAddr("dave");
    address internal erin = makeAddr("erin");

    bytes32 internal constant A = keccak256("agent-a");
    bytes32 internal constant B = keccak256("agent-b");
    bytes32 internal constant C = keccak256("agent-c");
    bytes32 internal constant JOB = keccak256("job-1");

    uint256 internal constant ONE = 1e18;
    uint256 internal constant MIN_STAKE = 100e18;
    uint256 internal constant MAX_STAKE = 5_000_000e18;

    function setUp() public {
        wage = new MockWAGE();
        patronage =
            new WageholdPatronage(wage, owner, splitter, treasury, 7 days, MIN_STAKE, MAX_STAKE);

        vm.startPrank(owner);
        patronage.registerBuilding(A, true);
        patronage.registerBuilding(B, true);
        patronage.registerBuilding(C, true);
        vm.stopPrank();

        address[5] memory users = [alice, bob, carol, dave, erin];
        for (uint256 i; i < users.length; ++i) {
            wage.mint(users[i], 10_000_000e18);
            vm.prank(users[i]);
            wage.approve(address(patronage), type(uint256).max);
        }
    }

    // ------------------------------------------------------------------
    // helpers
    // ------------------------------------------------------------------

    function _stake(address user, bytes32 agent, uint256 amount) internal {
        vm.prank(user);
        patronage.stake(agent, amount);
    }

    function _notify(bytes32 agent, uint256 amount) internal {
        wage.mint(address(patronage), amount);
        vm.prank(splitter);
        patronage.notifyReward(agent, JOB, amount);
    }

    function _pending(address user, bytes32 agent) internal view returns (uint256) {
        return patronage.pendingRewards(agent, user);
    }

    // ------------------------------------------------------------------
    // constructor / config
    // ------------------------------------------------------------------

    function test_Constructor_StoresConfig() public view {
        assertEq(address(patronage.wageToken()), address(wage));
        assertEq(patronage.owner(), owner);
        assertEq(patronage.splitter(), splitter);
        assertEq(patronage.treasury(), treasury);
        assertEq(patronage.cooldown(), 7 days);
        assertEq(patronage.minStake(), MIN_STAKE);
        assertEq(patronage.maxStakePerUser(), MAX_STAKE);
    }

    function test_Constructor_RevertsOnZeroAddressesAndBadCooldown() public {
        vm.expectRevert(WageholdPatronage.ZeroAddress.selector);
        new WageholdPatronage(wage, address(0), splitter, treasury, 7 days, MIN_STAKE, 0);
        vm.expectRevert(WageholdPatronage.ZeroAddress.selector);
        new WageholdPatronage(wage, owner, splitter, address(0), 7 days, MIN_STAKE, 0);
        vm.expectRevert(WageholdPatronage.CooldownOutOfBounds.selector);
        new WageholdPatronage(wage, owner, splitter, treasury, 12 hours, MIN_STAKE, 0);
        vm.expectRevert(WageholdPatronage.CooldownOutOfBounds.selector);
        new WageholdPatronage(wage, owner, splitter, treasury, 15 days, MIN_STAKE, 0);
    }

    // ------------------------------------------------------------------
    // stake
    // ------------------------------------------------------------------

    function test_Stake_CreditsPositionAndEmits() public {
        vm.expectEmit(true, true, false, true, address(patronage));
        emit WageholdPatronage.Staked(A, alice, 1_000 * ONE);
        _stake(alice, A, 1_000 * ONE);

        assertEq(patronage.stakeOf(A, alice), 1_000 * ONE);
        assertEq(patronage.totalStaked(A), 1_000 * ONE);
        assertEq(patronage.totalStakedAll(), 1_000 * ONE);
        assertEq(wage.balanceOf(address(patronage)), 1_000 * ONE);
        assertEq(patronage.accountedBalance(), 1_000 * ONE);
    }

    function test_Stake_RevertsOnUnregisteredBuilding() public {
        vm.expectRevert(WageholdPatronage.BuildingNotRegistered.selector);
        _stake(alice, keccak256("ghost"), 1_000 * ONE);
    }

    function test_Stake_RevertsOnZeroAndBelowMin() public {
        vm.expectRevert(WageholdPatronage.ZeroAmount.selector);
        _stake(alice, A, 0);
        vm.expectRevert(WageholdPatronage.BelowMinStake.selector);
        _stake(alice, A, MIN_STAKE - 1);
        _stake(alice, A, MIN_STAKE); // exactly the minimum is fine
    }

    function test_Stake_CapIsPerUserPerBuilding() public {
        _stake(alice, A, MAX_STAKE); // exactly the cap is fine
        vm.expectRevert(WageholdPatronage.ExceedsMaxStake.selector);
        _stake(alice, A, MIN_STAKE); // cap counts active stake across calls
        _stake(alice, B, MAX_STAKE); // a different building has its own cap
        _stake(bob, A, MAX_STAKE); // a different patron has their own cap
    }

    function test_Stake_CapZeroMeansNoCap() public {
        vm.prank(owner);
        patronage.setMaxStakePerUser(0);
        _stake(alice, A, 9_000_000 * ONE);
        assertEq(patronage.stakeOf(A, alice), 9_000_000 * ONE);
    }

    function test_Stake_CreditsActualReceived_FeeToken() public {
        FeeToken fee = new FeeToken();
        WageholdPatronage p =
            new WageholdPatronage(fee, owner, splitter, treasury, 7 days, MIN_STAKE, MAX_STAKE);
        vm.prank(owner);
        p.registerBuilding(A, true);

        fee.mint(alice, 10_000 * ONE);
        vm.startPrank(alice);
        fee.approve(address(p), type(uint256).max);
        p.stake(A, 1_000 * ONE);
        vm.stopPrank();

        // 1% burned in transit: the position is credited what arrived, never what was requested.
        assertEq(p.stakeOf(A, alice), 990 * ONE);
        assertEq(fee.balanceOf(address(p)), 990 * ONE);
        assertGe(fee.balanceOf(address(p)), p.accountedBalance());
    }

    function test_Stake_TopUpKeepsEarnedRewards() public {
        _stake(alice, A, 1_000 * ONE);
        _notify(A, 100 * ONE);
        _stake(alice, A, 1_000 * ONE); // top-up after a reward
        _notify(A, 100 * ONE);
        assertEq(_pending(alice, A), 200 * ONE); // sole patron: gets both rewards
    }

    // ------------------------------------------------------------------
    // pause: blocks stake only
    // ------------------------------------------------------------------

    function test_Pause_BlocksStakeOnly() public {
        _stake(alice, A, 1_000 * ONE);
        _notify(A, 100 * ONE);

        vm.prank(owner);
        patronage.pause();

        vm.expectRevert(Pausable.EnforcedPause.selector);
        _stake(bob, A, 1_000 * ONE);

        // everything else keeps working while paused
        _notify(A, 50 * ONE);
        vm.startPrank(alice);
        patronage.requestUnstake(A, 400 * ONE);
        patronage.claim(A);
        vm.warp(block.timestamp + 7 days);
        patronage.withdraw(A);
        vm.stopPrank();
        assertEq(patronage.stakeOf(A, alice), 600 * ONE);

        vm.prank(owner);
        patronage.unpause();
        _stake(bob, A, 1_000 * ONE);
    }

    function test_Pause_ClaimAndWithdrawWork() public {
        _stake(alice, A, 1_000 * ONE);
        _notify(A, 100 * ONE);
        vm.prank(alice);
        patronage.requestUnstake(A, 1_000 * ONE);
        vm.prank(owner);
        patronage.pause();

        uint256 before = wage.balanceOf(alice);
        vm.warp(block.timestamp + 7 days);
        vm.startPrank(alice);
        patronage.claim(A);
        patronage.withdraw(A);
        vm.stopPrank();
        assertEq(wage.balanceOf(alice), before + 100 * ONE + 1_000 * ONE);
    }

    function test_Unregister_BlocksOnlyNewStakes() public {
        _stake(alice, A, 1_000 * ONE);
        vm.prank(owner);
        patronage.registerBuilding(A, false);

        vm.expectRevert(WageholdPatronage.BuildingNotRegistered.selector);
        _stake(bob, A, 1_000 * ONE);

        _notify(A, 100 * ONE); // existing stakers keep earning
        assertEq(_pending(alice, A), 100 * ONE);

        vm.startPrank(alice);
        patronage.claim(A);
        patronage.requestUnstake(A, 1_000 * ONE);
        vm.warp(block.timestamp + 7 days);
        patronage.withdraw(A);
        vm.stopPrank();
        assertEq(patronage.stakeOf(A, alice), 0);
    }

    // ------------------------------------------------------------------
    // cooldown
    // ------------------------------------------------------------------

    function test_RequestUnstake_MovesToCooldownAndEarnsNothing() public {
        _stake(alice, A, 1_000 * ONE);
        _stake(bob, A, 1_000 * ONE);

        uint256 unlockAt = block.timestamp + 7 days;
        vm.expectEmit(true, true, false, true, address(patronage));
        emit WageholdPatronage.UnstakeRequested(A, alice, 1_000 * ONE, unlockAt);
        vm.prank(alice);
        patronage.requestUnstake(A, 1_000 * ONE);

        assertEq(patronage.stakeOf(A, alice), 0);
        assertEq(patronage.totalStaked(A), 1_000 * ONE);
        (uint256 cooling, uint256 at) = patronage.cooldownOf(A, alice);
        assertEq(cooling, 1_000 * ONE);
        assertEq(at, unlockAt);

        _notify(A, 100 * ONE);
        assertEq(_pending(alice, A), 0); // cooling funds earn nothing
        assertEq(_pending(bob, A), 100 * ONE);
    }

    function test_RequestUnstake_SettlesEarnedRewardsFirst() public {
        _stake(alice, A, 1_000 * ONE);
        _notify(A, 100 * ONE);
        vm.prank(alice);
        patronage.requestUnstake(A, 1_000 * ONE);
        assertEq(_pending(alice, A), 100 * ONE); // earned before the request is kept
    }

    function test_RequestUnstake_Reverts() public {
        _stake(alice, A, 1_000 * ONE);
        vm.startPrank(alice);
        vm.expectRevert(WageholdPatronage.ZeroAmount.selector);
        patronage.requestUnstake(A, 0);
        vm.expectRevert(WageholdPatronage.InsufficientStake.selector);
        patronage.requestUnstake(A, 1_000 * ONE + 1);
        vm.stopPrank();
    }

    function test_Withdraw_EnforcesCooldown() public {
        _stake(alice, A, 1_000 * ONE);
        vm.prank(alice);
        patronage.requestUnstake(A, 1_000 * ONE);
        uint256 unlockAt = block.timestamp + 7 days;

        vm.expectRevert(abi.encodeWithSelector(WageholdPatronage.StillCoolingDown.selector, unlockAt));
        vm.prank(alice);
        patronage.withdraw(A);

        vm.warp(unlockAt - 1);
        vm.expectRevert(abi.encodeWithSelector(WageholdPatronage.StillCoolingDown.selector, unlockAt));
        vm.prank(alice);
        patronage.withdraw(A);

        vm.warp(unlockAt);
        uint256 before = wage.balanceOf(alice);
        vm.expectEmit(true, true, false, true, address(patronage));
        emit WageholdPatronage.Withdrawn(A, alice, 1_000 * ONE);
        vm.prank(alice);
        patronage.withdraw(A);
        assertEq(wage.balanceOf(alice), before + 1_000 * ONE);
        assertEq(patronage.totalCooling(), 0);

        vm.expectRevert(WageholdPatronage.NothingToWithdraw.selector);
        vm.prank(alice);
        patronage.withdraw(A);
    }

    function test_SecondRequestRestartsCooldownForWholeBucket() public {
        _stake(alice, A, 1_000 * ONE);
        vm.prank(alice);
        patronage.requestUnstake(A, 400 * ONE);

        vm.warp(block.timestamp + 3 days);
        vm.prank(alice);
        patronage.requestUnstake(A, 600 * ONE);

        (uint256 cooling, uint256 at) = patronage.cooldownOf(A, alice);
        assertEq(cooling, 1_000 * ONE);
        assertEq(at, block.timestamp + 7 days);
    }

    function test_SetCooldown_AffectsOnlyFutureRequests() public {
        _stake(alice, A, 1_000 * ONE);
        vm.prank(alice);
        patronage.requestUnstake(A, 500 * ONE);
        uint256 firstUnlock = block.timestamp + 7 days;

        vm.prank(owner);
        patronage.setCooldown(14 days);
        (, uint256 at) = patronage.cooldownOf(A, alice);
        assertEq(at, firstUnlock); // running cooldown is never extended by the owner
    }

    function test_SetCooldown_Bounds() public {
        vm.startPrank(owner);
        patronage.setCooldown(1 days);
        patronage.setCooldown(14 days);
        vm.expectRevert(WageholdPatronage.CooldownOutOfBounds.selector);
        patronage.setCooldown(1 days - 1);
        vm.expectRevert(WageholdPatronage.CooldownOutOfBounds.selector);
        patronage.setCooldown(14 days + 1);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------
    // notifyReward
    // ------------------------------------------------------------------

    function test_Notify_SplitsProRata() public {
        _stake(alice, A, 3_000 * ONE);
        _stake(bob, A, 1_000 * ONE);

        wage.mint(address(patronage), 600 * ONE);
        vm.expectEmit(true, true, false, false, address(patronage));
        emit WageholdPatronage.RewardNotified(A, JOB, 600 * ONE, 0);
        vm.prank(splitter);
        patronage.notifyReward(A, JOB, 600 * ONE);

        assertEq(_pending(alice, A), 450 * ONE);
        assertEq(_pending(bob, A), 150 * ONE);
        assertEq(patronage.getPool(A).rewardsTotal, 600 * ONE);
        assertEq(patronage.totalRewardsOwed(), 600 * ONE);
    }

    function test_Notify_OnlyAffectsItsOwnBuilding() public {
        _stake(alice, A, 1_000 * ONE);
        _stake(alice, B, 1_000 * ONE);
        _notify(A, 100 * ONE);
        assertEq(_pending(alice, A), 100 * ONE);
        assertEq(_pending(alice, B), 0);
    }

    function test_Notify_NoStakers_RedirectsToTreasury() public {
        wage.mint(address(patronage), 600 * ONE);
        vm.expectEmit(true, true, false, true, address(patronage));
        emit WageholdPatronage.RewardRedirected(A, JOB, 600 * ONE, treasury);
        vm.prank(splitter);
        patronage.notifyReward(A, JOB, 600 * ONE);

        assertEq(wage.balanceOf(treasury), 600 * ONE);
        assertEq(wage.balanceOf(address(patronage)), 0);
        assertEq(patronage.getPool(A).redirectedTotal, 600 * ONE);
        assertEq(patronage.getPool(A).rewardsTotal, 0);
        assertEq(patronage.pendingRedirect(), 0);
        assertEq(patronage.accountedBalance(), 0);
    }

    function test_Notify_NoStakers_TreasuryRefuses_BooksAndFlushes() public {
        wage.setBlocked(treasury, true);
        _notify(A, 600 * ONE); // must NOT revert: the treasury can never block a split

        assertEq(wage.balanceOf(treasury), 0);
        assertEq(patronage.pendingRedirect(), 600 * ONE);
        assertGe(wage.balanceOf(address(patronage)), patronage.accountedBalance());

        vm.expectRevert(bytes("recipient blocked"));
        patronage.flushRedirect();

        wage.setBlocked(treasury, false);
        vm.prank(stranger); // permissionless
        patronage.flushRedirect();
        assertEq(wage.balanceOf(treasury), 600 * ONE);
        assertEq(patronage.pendingRedirect(), 0);

        vm.expectRevert(WageholdPatronage.NothingToFlush.selector);
        patronage.flushRedirect();
    }

    function test_Notify_RevertsFromNonSplitter() public {
        wage.mint(address(patronage), 100 * ONE);
        vm.expectRevert(WageholdPatronage.NotSplitter.selector);
        vm.prank(stranger);
        patronage.notifyReward(A, JOB, 100 * ONE);

        vm.expectRevert(WageholdPatronage.NotSplitter.selector);
        vm.prank(owner); // not even the owner
        patronage.notifyReward(A, JOB, 100 * ONE);
    }

    function test_Notify_RevertsWhenSplitterNotSetYet() public {
        WageholdPatronage p =
            new WageholdPatronage(wage, owner, address(0), treasury, 7 days, MIN_STAKE, 0);
        vm.expectRevert(WageholdPatronage.NotSplitter.selector);
        p.notifyReward(A, JOB, 1);
    }

    function test_Notify_RevertsWhenNotFunded() public {
        _stake(alice, A, 1_000 * ONE);

        // nothing transferred at all
        vm.expectRevert(WageholdPatronage.RewardNotFunded.selector);
        vm.prank(splitter);
        patronage.notifyReward(A, JOB, 1);

        // stakes can't be double-counted as funding: only 50 arrived, 100 claimed
        wage.mint(address(patronage), 50 * ONE);
        vm.expectRevert(WageholdPatronage.RewardNotFunded.selector);
        vm.prank(splitter);
        patronage.notifyReward(A, JOB, 100 * ONE);

        // the same arrived tokens can't fund two notifies
        vm.prank(splitter);
        patronage.notifyReward(A, JOB, 50 * ONE);
        vm.expectRevert(WageholdPatronage.RewardNotFunded.selector);
        vm.prank(splitter);
        patronage.notifyReward(A, JOB, 1);
    }

    function test_Notify_RevertsOnZeroAmount() public {
        vm.expectRevert(WageholdPatronage.ZeroAmount.selector);
        vm.prank(splitter);
        patronage.notifyReward(A, JOB, 0);
    }

    // ------------------------------------------------------------------
    // accounting
    // ------------------------------------------------------------------

    function test_Accounting_JoinAndLeaveBetweenNotifies() public {
        _stake(alice, A, 1_000 * ONE);
        _notify(A, 100 * ONE); // alice alone: +100

        _stake(bob, A, 1_000 * ONE);
        _notify(A, 100 * ONE); // 50 / 50

        vm.prank(alice);
        patronage.requestUnstake(A, 1_000 * ONE);
        _notify(A, 100 * ONE); // bob alone: +100

        _stake(carol, A, 2_000 * ONE);
        _notify(A, 300 * ONE); // bob 1000 / carol 2000 -> 100 / 200

        assertEq(_pending(alice, A), 150 * ONE);
        assertEq(_pending(bob, A), 250 * ONE);
        assertEq(_pending(carol, A), 200 * ONE);
        assertEq(_pending(alice, A) + _pending(bob, A) + _pending(carol, A), 600 * ONE);
    }

    function test_Accounting_RemainderIsCarriedNotLost() public {
        _stake(alice, A, 100 * ONE);
        _stake(bob, A, 100 * ONE);
        _stake(carol, A, 100 * ONE);

        // 100 wei over 3 equal stakers: 33.33.. each time. Carrying the remainder means after
        // three notifies each patron holds exactly 100 wei, nothing lost.
        _notify(A, 100);
        _notify(A, 100);
        _notify(A, 100);

        assertEq(_pending(alice, A), 100);
        assertEq(_pending(bob, A), 100);
        assertEq(_pending(carol, A), 100);
    }

    function test_Accounting_ClaimThenMoreRewards() public {
        _stake(alice, A, 1_000 * ONE);
        _notify(A, 100 * ONE);
        vm.prank(alice);
        patronage.claim(A);
        assertEq(_pending(alice, A), 0);
        _notify(A, 40 * ONE);
        assertEq(_pending(alice, A), 40 * ONE);
    }

    function test_Accounting_RewardsSurviveFullUnstake() public {
        _stake(alice, A, 1_000 * ONE);
        _notify(A, 100 * ONE);
        vm.prank(alice);
        patronage.requestUnstake(A, 1_000 * ONE);
        _notify(A, 100 * ONE); // nobody staked: redirected, alice earns nothing from it
        assertEq(_pending(alice, A), 100 * ONE);

        uint256 before = wage.balanceOf(alice);
        vm.prank(alice);
        patronage.claim(A);
        assertEq(wage.balanceOf(alice) - before, 100 * ONE);
    }

    function testFuzz_SingleNotify_ProRataWithinOneWei(uint96 a, uint96 b, uint96 reward) public {
        uint256 sa = bound(uint256(a), MIN_STAKE, MAX_STAKE);
        uint256 sb = bound(uint256(b), MIN_STAKE, MAX_STAKE);
        uint256 r = bound(uint256(reward), 1, 1e27);

        _stake(alice, A, sa);
        _stake(bob, A, sb);
        _notify(A, r);

        uint256 expA = (r * sa) / (sa + sb);
        uint256 expB = (r * sb) / (sa + sb);
        assertApproxEqAbs(_pending(alice, A), expA, 1);
        assertApproxEqAbs(_pending(bob, A), expB, 1);
        assertLe(_pending(alice, A) + _pending(bob, A), r); // never pays out more than notified
    }

    function testFuzz_ManyNotifies_NeverOverpay(uint96 a, uint96 b, uint96 c, uint96[6] memory rs)
        public
    {
        _stake(alice, A, bound(uint256(a), MIN_STAKE, MAX_STAKE));
        _stake(bob, A, bound(uint256(b), MIN_STAKE, MAX_STAKE));
        _stake(carol, A, bound(uint256(c), MIN_STAKE, MAX_STAKE));

        uint256 total;
        for (uint256 i; i < rs.length; ++i) {
            uint256 r = bound(uint256(rs[i]), 1, 1e24);
            _notify(A, r);
            total += r;
        }
        uint256 sum = _pending(alice, A) + _pending(bob, A) + _pending(carol, A);
        assertLe(sum, total);
        assertGe(sum + 6, total); // at most ~1 wei per patron lost to rounding in total
    }

    // ------------------------------------------------------------------
    // claim / claimMany
    // ------------------------------------------------------------------

    function test_Claim_PaysAndEmits() public {
        _stake(alice, A, 1_000 * ONE);
        _notify(A, 100 * ONE);

        uint256 before = wage.balanceOf(alice);
        vm.expectEmit(true, true, false, true, address(patronage));
        emit WageholdPatronage.Claimed(A, alice, 100 * ONE);
        vm.prank(alice);
        patronage.claim(A);

        assertEq(wage.balanceOf(alice) - before, 100 * ONE);
        assertEq(patronage.totalRewardsOwed(), 0);
        assertGe(wage.balanceOf(address(patronage)), patronage.accountedBalance());
    }

    function test_Claim_RevertsWhenNothingPending() public {
        vm.expectRevert(WageholdPatronage.NothingToClaim.selector);
        vm.prank(alice);
        patronage.claim(A);
    }

    function test_ClaimMany_AcrossBuildingsSkippingEmpty() public {
        _stake(alice, A, 1_000 * ONE);
        _stake(alice, B, 1_000 * ONE);
        _stake(alice, C, 1_000 * ONE);
        _notify(A, 100 * ONE);
        _notify(C, 40 * ONE); // B has nothing pending

        bytes32[] memory ids = new bytes32[](3);
        ids[0] = A;
        ids[1] = B;
        ids[2] = C;

        uint256 before = wage.balanceOf(alice);
        vm.prank(alice);
        patronage.claimMany(ids);
        assertEq(wage.balanceOf(alice) - before, 140 * ONE);
    }

    function test_ClaimMany_RevertsWhenWholeBatchEmpty() public {
        bytes32[] memory ids = new bytes32[](2);
        ids[0] = A;
        ids[1] = B;
        vm.expectRevert(WageholdPatronage.NothingToClaim.selector);
        vm.prank(alice);
        patronage.claimMany(ids);
    }

    // ------------------------------------------------------------------
    // security: owner powers, reentrancy
    // ------------------------------------------------------------------

    function test_Owner_CannotTouchStakedOrRewardWage() public {
        _stake(alice, A, 1_000 * ONE);
        _stake(bob, B, 2_000 * ONE);
        _notify(A, 100 * ONE);
        vm.prank(alice);
        patronage.requestUnstake(A, 400 * ONE); // some in cooldown too

        uint256 lockedBefore = wage.balanceOf(address(patronage));

        vm.startPrank(owner);
        vm.expectRevert(WageholdPatronage.CannotRescueWageToken.selector);
        patronage.rescueToken(wage, owner, 1);
        vm.expectRevert(WageholdPatronage.CannotRescueWageToken.selector);
        patronage.rescueToken(wage, owner, lockedBefore);
        // every other admin action leaves the funds exactly where they are
        patronage.registerBuilding(A, false);
        patronage.setCooldown(14 days);
        patronage.setSplitter(makeAddr("newSplitter"));
        patronage.setTreasury(makeAddr("newTreasury"));
        patronage.setMinStake(1);
        patronage.setMaxStakePerUser(1);
        patronage.pause();
        patronage.transferOwnership(stranger);
        vm.stopPrank();

        assertEq(wage.balanceOf(address(patronage)), lockedBefore);
        assertEq(wage.balanceOf(owner), 0);

        // and the patrons can still take everything out
        vm.warp(block.timestamp + 14 days);
        vm.startPrank(alice);
        patronage.claim(A);
        patronage.withdraw(A);
        patronage.requestUnstake(A, 600 * ONE);
        vm.stopPrank();
        vm.startPrank(bob);
        patronage.requestUnstake(B, 2_000 * ONE);
        vm.stopPrank();
        vm.warp(block.timestamp + 14 days);
        vm.prank(alice);
        patronage.withdraw(A);
        vm.prank(bob);
        patronage.withdraw(B);
        assertEq(wage.balanceOf(address(patronage)), 0);
    }

    function test_Owner_CanRescueOtherTokens() public {
        FeeToken stray = new FeeToken();
        stray.mint(address(patronage), 5 * ONE);
        vm.prank(owner);
        patronage.rescueToken(stray, treasury, 5 * ONE);
        assertEq(stray.balanceOf(treasury), 5 * ONE - (5 * ONE) / 100);
    }

    function test_AdminFunctions_OnlyOwner() public {
        vm.startPrank(stranger);
        vm.expectRevert(WageholdPatronage.NotOwner.selector);
        patronage.registerBuilding(A, false);
        vm.expectRevert(WageholdPatronage.NotOwner.selector);
        patronage.setCooldown(2 days);
        vm.expectRevert(WageholdPatronage.NotOwner.selector);
        patronage.setSplitter(stranger);
        vm.expectRevert(WageholdPatronage.NotOwner.selector);
        patronage.setTreasury(stranger);
        vm.expectRevert(WageholdPatronage.NotOwner.selector);
        patronage.setMinStake(0);
        vm.expectRevert(WageholdPatronage.NotOwner.selector);
        patronage.setMaxStakePerUser(0);
        vm.expectRevert(WageholdPatronage.NotOwnerOrGuardian.selector);
        patronage.pause();
        vm.expectRevert(WageholdPatronage.NotOwner.selector);
        patronage.unpause();
        vm.expectRevert(WageholdPatronage.NotOwner.selector);
        patronage.transferOwnership(stranger);
        vm.expectRevert(WageholdPatronage.NotOwner.selector);
        patronage.rescueToken(wage, stranger, 1);
        vm.stopPrank();
    }

    function test_SetSplitter_SwitchesWhoCanNotify() public {
        address newSplitter = makeAddr("newSplitter");
        vm.prank(owner);
        patronage.setSplitter(newSplitter);

        wage.mint(address(patronage), 10 * ONE);
        vm.expectRevert(WageholdPatronage.NotSplitter.selector);
        vm.prank(splitter);
        patronage.notifyReward(A, JOB, 10 * ONE);
        vm.prank(newSplitter);
        patronage.notifyReward(A, JOB, 10 * ONE);

        vm.expectRevert(WageholdPatronage.ZeroAddress.selector);
        vm.prank(owner);
        patronage.setSplitter(address(0));
    }

    function test_Ownership_TwoStep() public {
        vm.prank(owner);
        patronage.transferOwnership(alice);
        assertEq(patronage.owner(), owner); // not transferred until accepted

        vm.expectRevert(WageholdPatronage.NotPendingOwner.selector);
        vm.prank(bob);
        patronage.acceptOwnership();

        vm.prank(alice);
        patronage.acceptOwnership();
        assertEq(patronage.owner(), alice);
        assertEq(patronage.pendingOwner(), address(0));

        vm.expectRevert(WageholdPatronage.NotOwnerOrGuardian.selector);
        vm.prank(owner);
        patronage.pause();
    }

    function _hookSetup(bytes32 agent)
        internal
        returns (
            ReentrancyHookToken hook,
            WageholdPatronage p,
            PatronageReentrancyAttacker attacker
        )
    {
        hook = new ReentrancyHookToken();
        p = new WageholdPatronage(hook, owner, splitter, treasury, 7 days, MIN_STAKE, 0);
        vm.prank(owner);
        p.registerBuilding(agent, true);
        attacker = new PatronageReentrancyAttacker(p, hook, agent);
        hook.mint(address(attacker), 10_000 * ONE);
        hook.mint(address(this), 10_000 * ONE);
    }

    function test_Reentrancy_OnClaim() public {
        (ReentrancyHookToken hook, WageholdPatronage p, PatronageReentrancyAttacker attacker) =
            _hookSetup(A);
        attacker.stake(1_000 * ONE);

        hook.mint(address(p), 100 * ONE);
        vm.prank(splitter);
        p.notifyReward(A, JOB, 100 * ONE);

        hook.setHook(address(attacker));
        attacker.armAndClaim();

        assertTrue(attacker.hookFired());
        assertFalse(attacker.anyReentrySucceeded());
        assertEq(hook.balanceOf(address(attacker)), 9_000 * ONE + 100 * ONE);
        assertEq(p.pendingRewards(A, address(attacker)), 0);
        assertEq(p.totalRewardsOwed(), 0);
    }

    function test_Reentrancy_OnWithdraw() public {
        (ReentrancyHookToken hook, WageholdPatronage p, PatronageReentrancyAttacker attacker) =
            _hookSetup(A);
        attacker.stake(1_000 * ONE);
        attacker.requestUnstake(1_000 * ONE);
        vm.warp(block.timestamp + 7 days);

        hook.setHook(address(attacker));
        attacker.armAndWithdraw();

        assertTrue(attacker.hookFired());
        assertFalse(attacker.anyReentrySucceeded());
        assertEq(hook.balanceOf(address(attacker)), 10_000 * ONE);
        assertEq(p.totalCooling(), 0);
    }
}
