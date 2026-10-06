// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {WageholdPatronage} from "../src/WageholdPatronage.sol";
import {MockWAGE} from "./mocks/MockWAGE.sol";

/// @dev Drives random, valid sequences of patron and splitter actions. Ghost state records the
/// "pending rewards never decrease without a claim" property, which can't be read from the
/// contract after the fact.
contract PatronageHandler is Test {
    WageholdPatronage public immutable patronage;
    MockWAGE public immutable wage;
    address public immutable splitter;
    address public immutable owner;

    address[] internal _actors;
    bytes32[] internal _agents;

    uint256 public jobNonce;
    uint256 public totalNotifiedToStakers;
    bool public pendingDecreased;
    mapping(address => mapping(bytes32 => uint256)) internal _lastPending;

    constructor(
        WageholdPatronage p,
        MockWAGE w,
        address _splitter,
        address _owner,
        address[] memory actors_,
        bytes32[] memory agents_
    ) {
        patronage = p;
        wage = w;
        splitter = _splitter;
        owner = _owner;
        _actors = actors_;
        _agents = agents_;
        for (uint256 i; i < actors_.length; ++i) {
            wage.mint(actors_[i], 100_000_000e18);
            vm.prank(actors_[i]);
            wage.approve(address(p), type(uint256).max);
        }
    }

    function actors() external view returns (address[] memory) {
        return _actors;
    }

    function agents() external view returns (bytes32[] memory) {
        return _agents;
    }

    function _a(uint256 i) internal view returns (address) {
        return _actors[i % _actors.length];
    }

    function _g(uint256 i) internal view returns (bytes32) {
        return _agents[i % _agents.length];
    }

    /// @dev After every action, no patron's claimable amount may be lower than it was, except
    /// the entry that was just claimed (reset to 0 by `claim`).
    function _check() internal {
        for (uint256 u; u < _actors.length; ++u) {
            for (uint256 g; g < _agents.length; ++g) {
                uint256 cur = patronage.pendingRewards(_agents[g], _actors[u]);
                if (cur < _lastPending[_actors[u]][_agents[g]]) pendingDecreased = true;
                _lastPending[_actors[u]][_agents[g]] = cur;
            }
        }
    }

    function stake(uint256 ai, uint256 gi, uint256 amount) external {
        address a = _a(ai);
        bytes32 g = _g(gi);
        if (patronage.paused() || !patronage.isBuilding(g)) return;
        amount = bound(amount, patronage.minStake(), 1_000_000e18);
        uint256 cap = patronage.maxStakePerUser();
        if (cap != 0 && patronage.stakeOf(g, a) + amount > cap) return;
        vm.prank(a);
        patronage.stake(g, amount);
        _check();
    }

    function requestUnstake(uint256 ai, uint256 gi, uint256 amount) external {
        address a = _a(ai);
        bytes32 g = _g(gi);
        uint256 staked = patronage.stakeOf(g, a);
        if (staked == 0) return;
        amount = bound(amount, 1, staked);
        vm.prank(a);
        patronage.requestUnstake(g, amount);
        _check();
    }

    function withdraw(uint256 ai, uint256 gi) external {
        address a = _a(ai);
        bytes32 g = _g(gi);
        (uint256 cooling, uint256 unlockAt) = patronage.cooldownOf(g, a);
        if (cooling == 0) return;
        if (block.timestamp < unlockAt) vm.warp(unlockAt);
        vm.prank(a);
        patronage.withdraw(g);
        _check();
    }

    function claim(uint256 ai, uint256 gi) external {
        address a = _a(ai);
        bytes32 g = _g(gi);
        if (patronage.pendingRewards(g, a) == 0) return;
        vm.prank(a);
        patronage.claim(g);
        _lastPending[a][g] = 0;
        _check();
    }

    function notify(uint256 gi, uint256 amount) external {
        bytes32 g = _g(gi);
        amount = bound(amount, 1, 200_000e18);
        wage.mint(address(patronage), amount);
        vm.prank(splitter);
        patronage.notifyReward(g, bytes32(++jobNonce), amount);
        _check();
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 0, 10 days));
    }

    function togglePause() external {
        // read state BEFORE pranking: vm.prank applies only to the very next call
        bool isPaused = patronage.paused();
        vm.prank(owner);
        if (isPaused) patronage.unpause();
        else patronage.pause();
        _check();
    }

    function toggleBuilding(uint256 gi) external {
        bytes32 g = _g(gi);
        bool on = patronage.isBuilding(g);
        vm.prank(owner);
        patronage.registerBuilding(g, !on);
        _check();
    }
}

contract WageholdPatronageInvariantTest is Test {
    WageholdPatronage internal patronage;
    MockWAGE internal wage;
    PatronageHandler internal handler;

    address internal owner = makeAddr("owner");
    address internal splitter = makeAddr("splitter");
    address internal treasury = makeAddr("treasury");

    address[] internal actors;
    bytes32[] internal agents;

    function setUp() public {
        wage = new MockWAGE();
        patronage =
            new WageholdPatronage(wage, owner, splitter, treasury, 7 days, 100e18, 5_000_000e18);

        agents.push(keccak256("agent-a"));
        agents.push(keccak256("agent-b"));
        agents.push(keccak256("agent-c"));
        vm.startPrank(owner);
        for (uint256 i; i < agents.length; ++i) {
            patronage.registerBuilding(agents[i], true);
        }
        vm.stopPrank();

        actors.push(makeAddr("alice"));
        actors.push(makeAddr("bob"));
        actors.push(makeAddr("carol"));
        actors.push(makeAddr("dave"));
        actors.push(makeAddr("erin"));

        handler = new PatronageHandler(patronage, wage, splitter, owner, actors, agents);
        targetContract(address(handler));
    }

    /// WAGE.balanceOf(patronage) >= Σ staked + Σ cooling + Σ unclaimed rewards (+ unsent treasury share)
    function invariant_BalanceCoversEveryLiability() public view {
        assertGe(wage.balanceOf(address(patronage)), patronage.accountedBalance());
    }

    /// totalStaked[agentId] == Σ stake.amount for that agent, and the global total matches.
    function invariant_PoolTotalsEqualSumOfPositions() public view {
        uint256 global;
        for (uint256 g; g < agents.length; ++g) {
            uint256 sum;
            for (uint256 u; u < actors.length; ++u) {
                sum += patronage.stakeOf(agents[g], actors[u]);
            }
            assertEq(patronage.totalStaked(agents[g]), sum);
            global += sum;
        }
        assertEq(patronage.totalStakedAll(), global);
    }

    function invariant_CoolingTotalEqualsSumOfBuckets() public view {
        uint256 sum;
        for (uint256 g; g < agents.length; ++g) {
            for (uint256 u; u < actors.length; ++u) {
                (uint256 cooling,) = patronage.cooldownOf(agents[g], actors[u]);
                sum += cooling;
            }
        }
        assertEq(patronage.totalCooling(), sum);
    }

    /// Σ what patrons can claim never exceeds what the contract has booked as owed to patrons.
    function invariant_ClaimableNeverExceedsRewardsOwed() public view {
        uint256 sum;
        for (uint256 g; g < agents.length; ++g) {
            for (uint256 u; u < actors.length; ++u) {
                sum += patronage.pendingRewards(agents[g], actors[u]);
            }
        }
        assertLe(sum, patronage.totalRewardsOwed());
    }

    /// A user's claimable amount never decreases except by that user's own claim.
    function invariant_ClaimableNeverDecreasesWithoutClaim() public view {
        assertFalse(handler.pendingDecreased());
    }
}
