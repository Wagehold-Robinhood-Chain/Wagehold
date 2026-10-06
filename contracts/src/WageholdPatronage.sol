// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IWageholdPatronage} from "./interfaces/IWageholdPatronage.sol";

/// @title WageholdPatronage
/// @notice Patrons stake $WAGE on a building (an agent). Every time that building's work is sealed
/// and split, `WageholdSplitterV2` sends the 60% patron cut here and the stakers of that building
/// share it pro rata, claimable on-chain at any time.
/// @dev Accounting is the standard reward-per-share accumulator (MasterChef / StakingRewards):
/// O(1) per seal, O(1) per user action. Two deliberate differences from the textbook version:
///   * `PRECISION` is 1e27, not 1e18, so that a single notify is exact to within ~1 wei for any
///     stake up to 1e27 base units (with 1e18 the error grows with the stake: stake / 1e18 wei).
///   * `rewardDebt` is stored unscaled and divided by `PRECISION` only on the difference
///     `amount * (acc - accAtLastUpdate) / PRECISION`. Dividing the debt first (the textbook form)
///     can over-credit a patron by 1 wei per settle, so the sum of claims could exceed what was
///     notified and the last claim could revert. Flooring the difference only ever rounds down.
///   * the integer-division remainder of every notify is carried into the next notify of the same
///     building, so no reward dust is lost to rounding.
///
/// Charter guarantees enforced by construction:
///   * No admin path can move staked $WAGE, cooling $WAGE or patron rewards. The owner can only
///     change parameters and rescue tokens that are NOT $WAGE. There is no sweep/emergency path.
///   * `claim`, `claimMany` and `withdraw` are never blocked by `pause()` or by unregistering a
///     building; pausing only blocks new stakes.
///   * `notifyReward` is only callable by the Splitter AND only credits tokens that are actually
///     here (balance check), so a reward can never be credited without $WAGE backing it.
///
/// Owner is a hand-rolled two-step owner, same family of pattern as the other Wagehold contracts.
/// The 24-48h timelock on parameter setters (brief H4) is applied by making a timelock contract
/// the owner at deploy time, not by in-contract queues. The one thing a delay would hurt is
/// incident response, so `guardian` may `pause()` immediately (stake-blocking only, no fund access).
contract WageholdPatronage is IWageholdPatronage, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    uint256 public constant PRECISION = 1e27;
    uint32 public constant MIN_COOLDOWN = 1 days;
    uint32 public constant MAX_COOLDOWN = 14 days;

    struct Position {
        uint256 amount; // actively staked, earns rewards
        uint256 rewardDebt; // amount * accRewardPerShare at last update (NOT divided by PRECISION)
        uint256 pendingClaim; // rewards settled but not yet claimed
        uint256 cooling; // requested for unstake, earns nothing
        uint64 unlockAt; // when `cooling` can be withdrawn
    }

    struct Pool {
        uint256 totalStaked;
        uint256 accRewardPerShare; // scaled by PRECISION
        uint256 remainder; // carried rounding remainder, in PRECISION-scaled units
        uint256 rewardsTotal; // all-time rewards credited to this building's patrons
        uint256 redirectedTotal; // all-time rewards routed to the treasury (no stakers)
    }

    IERC20 public immutable wageToken;

    address public owner;
    address public pendingOwner;
    /// @notice Optional hot-path address that may `pause()` immediately (incident response) without
    /// waiting for the timelock that owns this contract. It can ONLY pause, and pausing only blocks
    /// new stakes. Unpausing and every other setter stay with `owner`. Zero = disabled.
    address public guardian;
    /// @notice The only address allowed to call `notifyReward` (Splitter v2). May be zero until set.
    address public splitter;
    /// @notice Receives the patron cut of a building that has no stakers.
    address public treasury;
    uint32 public cooldown;
    uint256 public minStake;
    /// @notice Per-patron cap per building on actively staked amount. 0 = no cap.
    uint256 public maxStakePerUser;

    mapping(bytes32 => bool) public isBuilding;

    /// @notice Σ actively staked over all buildings.
    uint256 public totalStakedAll;
    /// @notice Σ amounts in cooldown.
    uint256 public totalCooling;
    /// @notice Σ rewards credited to patrons and not yet claimed (includes sub-wei carry dust).
    uint256 public totalRewardsOwed;
    /// @notice Treasury share that could not be pushed yet; see `flushRedirect`.
    uint256 public pendingRedirect;

    mapping(bytes32 => Pool) private _pools;
    mapping(bytes32 => mapping(address => Position)) private _positions;

    event Staked(bytes32 indexed agentId, address indexed user, uint256 amount);
    event UnstakeRequested(
        bytes32 indexed agentId, address indexed user, uint256 amount, uint256 unlockAt
    );
    event Withdrawn(bytes32 indexed agentId, address indexed user, uint256 amount);
    event Claimed(bytes32 indexed agentId, address indexed user, uint256 amount);
    event RewardNotified(
        bytes32 indexed agentId, bytes32 indexed jobId, uint256 amount, uint256 accRewardPerShare
    );
    event RewardRedirected(
        bytes32 indexed agentId, bytes32 indexed jobId, uint256 amount, address to
    );
    event RedirectFlushed(address indexed to, uint256 amount);
    event BuildingRegistered(bytes32 indexed agentId, bool on);
    event CooldownUpdated(uint32 newCooldown);
    event SplitterUpdated(address indexed newSplitter);
    event TreasuryUpdated(address indexed newTreasury);
    event MinStakeUpdated(uint256 newMinStake);
    event MaxStakePerUserUpdated(uint256 newMax);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnerUpdated(address indexed newOwner);
    event GuardianUpdated(address indexed newGuardian);
    event TokenRescued(address indexed token, address indexed to, uint256 amount);

    error ZeroAddress();
    error ZeroAmount();
    error NotOwner();
    error NotPendingOwner();
    error NotOwnerOrGuardian();
    error NotSplitter();
    error BuildingNotRegistered();
    error BelowMinStake();
    error ExceedsMaxStake();
    error InsufficientStake();
    error StillCoolingDown(uint256 unlockAt);
    error NothingToWithdraw();
    error NothingToClaim();
    error NothingToFlush();
    error RewardNotFunded();
    error CooldownOutOfBounds();
    error CannotRescueWageToken();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(
        IERC20 _wageToken,
        address _owner,
        address _splitter,
        address _treasury,
        uint32 _cooldown,
        uint256 _minStake,
        uint256 _maxStakePerUser
    ) {
        if (address(_wageToken) == address(0) || _owner == address(0) || _treasury == address(0)) {
            revert ZeroAddress();
        }
        if (_cooldown < MIN_COOLDOWN || _cooldown > MAX_COOLDOWN) revert CooldownOutOfBounds();

        wageToken = _wageToken;
        owner = _owner;
        // slither-disable-next-line missing-zero-check
        splitter = _splitter; // zero allowed: Patronage and Splitter v2 reference each other
        treasury = _treasury;
        cooldown = _cooldown;
        minStake = _minStake;
        maxStakePerUser = _maxStakePerUser;
    }

    // ---------------------------------------------------------------------
    // Patron actions
    // ---------------------------------------------------------------------

    /// @notice Stakes $WAGE on a registered building. Credits the amount that actually arrived
    /// (balance delta), so a fee-on-transfer token can never over-credit a position.
    function stake(bytes32 agentId, uint256 amount) external nonReentrant whenNotPaused {
        if (!isBuilding[agentId]) revert BuildingNotRegistered();
        if (amount == 0) revert ZeroAmount();

        uint256 balBefore = wageToken.balanceOf(address(this));
        wageToken.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = wageToken.balanceOf(address(this)) - balBefore;

        // slither-disable-next-line incorrect-equality
        if (received == 0) revert ZeroAmount();
        if (received < minStake) revert BelowMinStake();

        Pool storage p = _pools[agentId];
        Position storage s = _positions[agentId][msg.sender];

        uint256 newAmount = s.amount + received;
        if (maxStakePerUser != 0 && newAmount > maxStakePerUser) revert ExceedsMaxStake();

        _settle(p, s);
        s.amount = newAmount;
        s.rewardDebt = newAmount * p.accRewardPerShare;
        p.totalStaked += received;
        totalStakedAll += received;

        emit Staked(agentId, msg.sender, received);
    }

    /// @notice Moves `amount` out of the earning stake into the cooldown bucket. Rewards earned so
    /// far are settled first. Cooling funds earn nothing. A new request restarts the cooldown for
    /// the whole bucket (it is a single bucket per building per patron).
    /// @dev Not pausable and not gated on `isBuilding`: exiting is always possible.
    function requestUnstake(bytes32 agentId, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        Pool storage p = _pools[agentId];
        Position storage s = _positions[agentId][msg.sender];
        if (amount > s.amount) revert InsufficientStake();

        _settle(p, s);
        s.amount -= amount;
        s.rewardDebt = s.amount * p.accRewardPerShare;
        p.totalStaked -= amount;
        totalStakedAll -= amount;

        s.cooling += amount;
        totalCooling += amount;
        uint64 unlockAt = uint64(block.timestamp + cooldown);
        s.unlockAt = unlockAt;

        emit UnstakeRequested(agentId, msg.sender, amount, unlockAt);
    }

    /// @notice Returns the cooled-down amount once `unlockAt` has passed. Works while paused.
    function withdraw(bytes32 agentId) external nonReentrant {
        Position storage s = _positions[agentId][msg.sender];
        uint256 amount = s.cooling;
        if (amount == 0) revert NothingToWithdraw();
        // slither-disable-next-line timestamp
        if (block.timestamp < s.unlockAt) revert StillCoolingDown(s.unlockAt);

        s.cooling = 0;
        s.unlockAt = 0;
        totalCooling -= amount;
        wageToken.safeTransfer(msg.sender, amount);

        emit Withdrawn(agentId, msg.sender, amount);
    }

    /// @notice Claims all settled and accruing rewards for one building. Works while paused.
    function claim(bytes32 agentId) external nonReentrant {
        uint256 paid = _claim(agentId);
        if (paid == 0) revert NothingToClaim();
    }

    /// @notice Claims several buildings in one transaction. Buildings with nothing pending are
    /// skipped; reverts only if the whole batch pays nothing. Works while paused.
    function claimMany(bytes32[] calldata agentIds) external nonReentrant {
        uint256 total = 0;
        for (uint256 i = 0; i < agentIds.length; ++i) {
            total += _claim(agentIds[i]);
        }
        if (total == 0) revert NothingToClaim();
    }

    // ---------------------------------------------------------------------
    // Splitter-only
    // ---------------------------------------------------------------------

    /// @notice Credits `amount` of $WAGE to `agentId`'s patrons pro rata. The tokens must already
    /// be in this contract: the call reverts if the unaccounted balance is smaller than `amount`,
    /// so a reward without matching $WAGE is impossible. With no stakers the amount goes to the
    /// treasury instead (booked in `pendingRedirect` if the token refuses the transfer, so this
    /// function can never be blocked by the treasury).
    function notifyReward(bytes32 agentId, bytes32 jobId, uint256 amount) external nonReentrant {
        if (msg.sender != splitter) revert NotSplitter();
        if (amount == 0) revert ZeroAmount();
        if (wageToken.balanceOf(address(this)) < accountedBalance() + amount) {
            revert RewardNotFunded();
        }

        Pool storage p = _pools[agentId];
        uint256 staked = p.totalStaked;

        if (staked == 0) {
            p.redirectedTotal += amount;
            pendingRedirect += amount;
            emit RewardRedirected(agentId, jobId, amount, treasury);
            _tryFlushRedirect();
            return;
        }

        uint256 scaled = amount * PRECISION + p.remainder;
        p.accRewardPerShare += scaled / staked;
        p.remainder = scaled % staked;
        p.rewardsTotal += amount;
        totalRewardsOwed += amount;

        emit RewardNotified(agentId, jobId, amount, p.accRewardPerShare);
    }

    /// @notice Retries sending any treasury share the token previously refused. Permissionless:
    /// the destination is `treasury`, a caller can only ever deliver, never redirect.
    function flushRedirect() external nonReentrant {
        uint256 amount = pendingRedirect;
        if (amount == 0) revert NothingToFlush();

        pendingRedirect = 0;
        wageToken.safeTransfer(treasury, amount);
        emit RedirectFlushed(treasury, amount);
    }

    // ---------------------------------------------------------------------
    // Owner (Safe multisig behind a timelock in production)
    // ---------------------------------------------------------------------

    /// @notice Unregistering only blocks NEW stakes. Existing stakes keep earning and can always
    /// request unstake, withdraw and claim.
    function registerBuilding(bytes32 agentId, bool on) external onlyOwner {
        isBuilding[agentId] = on;
        emit BuildingRegistered(agentId, on);
    }

    /// @notice Applies to future `requestUnstake` calls only; a running cooldown is never extended.
    function setCooldown(uint32 newCooldown) external onlyOwner {
        if (newCooldown < MIN_COOLDOWN || newCooldown > MAX_COOLDOWN) revert CooldownOutOfBounds();
        cooldown = newCooldown;
        emit CooldownUpdated(newCooldown);
    }

    function setSplitter(address newSplitter) external onlyOwner {
        if (newSplitter == address(0)) revert ZeroAddress();
        splitter = newSplitter;
        emit SplitterUpdated(newSplitter);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        treasury = newTreasury;
        emit TreasuryUpdated(newTreasury);
    }

    function setMinStake(uint256 newMinStake) external onlyOwner {
        minStake = newMinStake;
        emit MinStakeUpdated(newMinStake);
    }

    function setMaxStakePerUser(uint256 newMax) external onlyOwner {
        maxStakePerUser = newMax;
        emit MaxStakePerUserUpdated(newMax);
    }

    /// @notice Blocks `stake` only. Claim, withdraw, request-unstake and rewards are unaffected.
    /// @dev Callable by `owner` or `guardian`. Pausing cannot touch funds, so a fast key is safe.
    function pause() external {
        if (msg.sender != owner && msg.sender != guardian) revert NotOwnerOrGuardian();
        _pause();
    }

    /// @notice Sets (or clears, with address(0)) the guardian. Owner only, therefore timelocked.
    function setGuardian(address newGuardian) external onlyOwner {
        guardian = newGuardian;
        emit GuardianUpdated(newGuardian);
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        owner = msg.sender;
        pendingOwner = address(0);
        emit OwnerUpdated(msg.sender);
    }

    /// @notice Recovers tokens sent here by mistake. Can NEVER touch $WAGE: staked funds, cooling
    /// funds and rewards all live in $WAGE, so there is no admin path to any of them.
    function rescueToken(IERC20 token, address to, uint256 amount) external onlyOwner {
        if (address(token) == address(wageToken)) revert CannotRescueWageToken();
        if (to == address(0)) revert ZeroAddress();
        token.safeTransfer(to, amount);
        emit TokenRescued(address(token), to, amount);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice Everything this contract owes in $WAGE: stakes + cooling + unclaimed rewards +
    /// unsent treasury share. `wageToken.balanceOf(this)` must always be >= this.
    function accountedBalance() public view returns (uint256) {
        return totalStakedAll + totalCooling + totalRewardsOwed + pendingRedirect;
    }

    function pendingRewards(bytes32 agentId, address user) external view returns (uint256) {
        Pool storage p = _pools[agentId];
        Position storage s = _positions[agentId][user];
        return (s.amount * p.accRewardPerShare - s.rewardDebt) / PRECISION + s.pendingClaim;
    }

    function stakeOf(bytes32 agentId, address user) external view returns (uint256) {
        return _positions[agentId][user].amount;
    }

    function cooldownOf(bytes32 agentId, address user)
        external
        view
        returns (uint256 amount, uint256 unlockAt)
    {
        Position storage s = _positions[agentId][user];
        return (s.cooling, s.unlockAt);
    }

    function getPool(bytes32 agentId) external view returns (Pool memory) {
        return _pools[agentId];
    }

    function getPosition(bytes32 agentId, address user) external view returns (Position memory) {
        return _positions[agentId][user];
    }

    function totalStaked(bytes32 agentId) external view returns (uint256) {
        return _pools[agentId].totalStaked;
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    /// @dev Moves rewards accrued since the last update into `pendingClaim`. Callers must reset
    /// `rewardDebt` after changing `amount`.
    function _settle(Pool storage p, Position storage s) private {
        uint256 amount = s.amount;
        if (amount == 0) return;
        uint256 pending = (amount * p.accRewardPerShare - s.rewardDebt) / PRECISION;
        if (pending != 0) s.pendingClaim += pending;
    }

    function _claim(bytes32 agentId) private returns (uint256 paid) {
        Pool storage p = _pools[agentId];
        Position storage s = _positions[agentId][msg.sender];

        _settle(p, s);
        s.rewardDebt = s.amount * p.accRewardPerShare;

        paid = s.pendingClaim;
        if (paid == 0) return 0;

        s.pendingClaim = 0;
        totalRewardsOwed -= paid;
        wageToken.safeTransfer(msg.sender, paid);

        emit Claimed(agentId, msg.sender, paid);
    }

    /// @dev Best-effort push of `pendingRedirect` to the treasury. A refusal (blacklist, pause)
    /// leaves the amount booked for `flushRedirect` instead of reverting the Splitter's split.
    function _tryFlushRedirect() private {
        uint256 amount = pendingRedirect;
        if (amount == 0) return;

        pendingRedirect = 0;
        address to = treasury;
        // The callee is the trusted $WAGE token and every caller of this function is nonReentrant.
        // slither-disable-next-line reentrancy-no-eth
        (bool ok, bytes memory ret) =
            address(wageToken).call(abi.encodeCall(IERC20.transfer, (to, amount)));
        bool success = ok && (ret.length == 0 || (ret.length >= 32 && abi.decode(ret, (bool))));

        if (success) {
            emit RedirectFlushed(to, amount);
        } else {
            pendingRedirect = amount;
        }
    }
}
