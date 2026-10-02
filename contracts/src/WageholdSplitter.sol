// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {WageholdStrongbox} from "./WageholdStrongbox.sol";

/// @title WageholdSplitter
/// @notice Splits a released wage 60/20/10/10 between Patrons, Lamp Oil, the Tithe and the
/// Furnace (burn) -- Revision 1 (`wagehold-lore.md` v2, `wagehold-handoff.md` v2).
/// @dev This contract is the `payee` `WageholdStrongbox` was already designed to accept without
/// any change to it (see `WageholdStrongbox` scope note): once a job's payee is set to a
/// `WageholdSplitter`, `approve()` credits the *whole* wage to this contract's pending balance
/// in the Strongbox, same as it would credit a plain wallet. Splitting that single credit four
/// ways per job needs bookkeeping this contract owns, because `WageholdStrongbox.pendingWithdrawals`
/// is keyed by address only -- it has no notion of "this slice of the balance belongs to job X".
/// `registerJob` is that bookkeeping: it snapshots a job's amount and its Patron pool address
/// *before* the job is approved, so `pullAndSplit` always knows exactly how much of whatever it
/// pulls from the Strongbox belongs to which job, no matter how many other jobs share this same
/// Splitter instance and get approved around the same time.
///
/// Expected call order for a single job:
///   1. `council` calls `strongbox.setPayee(jobId, address(splitter))` (on the Strongbox itself).
///   2. `council` calls `splitter.registerJob(jobId, patronPool)` (on this contract).
///   3. Client calls `strongbox.approve(jobId)` -- Strongbox credits this contract's pending
///      balance by the job's full amount.
///   4. Anyone calls `splitter.pullAndSplit(jobId)` -- pulls from the Strongbox if needed and
///      credits Patrons / Lamp Oil / Tithe here, each by pull-payment, and books the Furnace share.
///   5. Each of the three destinations calls `splitter.withdraw()` on their own behalf.
///   6. `pullAndSplit` burns the Furnace share automatically; anyone can call `splitter.burn()` to
///      retry if the token refused the transfer at that moment.
///
/// One `WageholdSplitter` can serve many Wrights and many jobs: `lampOilTreasury` and
/// `titheTreasury` are shared (the Charter's split percentages are the same for every Wright --
/// see `components/revenue-split.tsx`), while each job's Patron pool address is supplied
/// per-job via `registerJob`, since Patron pools are per-Wright (Fase 4, not built yet -- for
/// now `patronPool` is just whatever placeholder address `council` is told to pass in).
contract WageholdSplitter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Basis-point weights for the 60/20/10/10 split. Tithe is not a constant: it takes
    /// the remainder (10% plus integer-division dust), so the four parts always sum to the
    /// wage exactly.
    uint256 public constant PATRON_BPS = 6_000;
    uint256 public constant LAMP_OIL_BPS = 2_000;
    uint256 public constant TITHE_BPS = 1_000;
    uint256 public constant FURNACE_BPS = 1_000;
    uint256 public constant BPS_DENOM = 10_000;

    /// @notice Burn destination. Conventional dead address: OpenZeppelin's ERC20 rejects
    /// transfers to `address(0)`, and this works for any ERC20 without needing `burn()` on it.
    /// Tokens sent here leave circulation but still count in `totalSupply()`.
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    struct SplitJob {
        address patronPool; // where this job's 60% goes -- per-Wright, set at registration
        uint256 amount; // snapshot of the job's wage at registration time
        bool split; // true once pullAndSplit has credited all four parts
    }

    /// @notice The ERC20 wages are denominated in (matches `WageholdStrongbox.wageToken`).
    IERC20 public immutable wageToken;

    /// @notice The Strongbox this Splitter pulls approved wages from.
    WageholdStrongbox public immutable strongbox;

    /// @notice Operator address that registers jobs -- mirrors `WageholdStrongbox.council`
    /// (Charter II: never an agent's own address). Can be the same EOA/Safe as the Strongbox's
    /// council in practice, but is tracked separately since this is a separate contract.
    address public council;

    /// @notice Contract admin: can rotate `council`/`owner`/the two shared treasuries. A Safe
    /// multisig in production, never an agent. Hand-rolled for the same reason
    /// `WageholdStrongbox` doesn't use OpenZeppelin's `Ownable` (see its comment).
    address public owner;

    /// @notice Shared 20% destination ("Lamp Oil" -- operating costs, `wagehold-lore.md` §6).
    address public lampOilTreasury;

    /// @notice Shared 10% destination ("Tithe" -- protocol/charity, `wagehold-lore.md` §6).
    address public titheTreasury;

    mapping(bytes32 => SplitJob) private _splits;

    /// @notice Pull-payment ledger, same pattern as `WageholdStrongbox.pendingWithdrawals` and
    /// for the same reason: a misbehaving `patronPool` (or treasury) address can never block
    /// `pullAndSplit` from crediting the other two destinations.
    mapping(address => uint256) public pendingWithdrawals;

    /// @notice Furnace share booked by `pullAndSplit` and not yet sent to `BURN_ADDRESS`. Normally
    /// 0: `pullAndSplit` burns it in the same transaction. It is non-zero only if the token
    /// refused that transfer, and stays there until `burn()` succeeds.
    uint256 public pendingBurn;

    /// @notice Lifetime total actually sent to `BURN_ADDRESS`. Feeds the app's Furnace stat.
    uint256 public totalBurned;

    event JobRegistered(bytes32 indexed jobId, address indexed patronPool, uint256 amount);
    event JobSplit(
        bytes32 indexed jobId,
        address indexed patronPool,
        uint256 patronAmount,
        uint256 lampOilAmount,
        uint256 titheAmount,
        uint256 burnAmount
    );
    event Withdrawn(address indexed to, uint256 amount);
    event Burned(address indexed caller, uint256 amount);
    event CouncilUpdated(address indexed newCouncil);
    event OwnerUpdated(address indexed newOwner);
    event LampOilTreasuryUpdated(address indexed newTreasury);
    event TitheTreasuryUpdated(address indexed newTreasury);

    error ZeroAddress();
    error NotCouncil();
    error NotOwner();
    error JobNotOpenInStrongbox();
    error PayeeMismatch();
    error JobAlreadyRegistered();
    error JobNotRegistered();
    error JobAlreadySplit();
    error JobNotReleasedYet();
    error PayeeChangedSinceRegistration();
    error NothingToWithdraw();
    error NothingToBurn();

    modifier onlyCouncil() {
        if (msg.sender != council) revert NotCouncil();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(
        IERC20 _wageToken,
        WageholdStrongbox _strongbox,
        address _council,
        address _owner,
        address _lampOilTreasury,
        address _titheTreasury
    ) {
        if (
            address(_wageToken) == address(0) || address(_strongbox) == address(0)
                || _council == address(0) || _owner == address(0) || _lampOilTreasury == address(0)
                || _titheTreasury == address(0)
        ) {
            revert ZeroAddress();
        }

        wageToken = _wageToken;
        strongbox = _strongbox;
        council = _council;
        owner = _owner;
        lampOilTreasury = _lampOilTreasury;
        titheTreasury = _titheTreasury;
    }

    // ---------------------------------------------------------------------
    // Council actions
    // ---------------------------------------------------------------------

    /// @notice Snapshots `jobId`'s wage amount and records which Patron pool gets its 60%,
    /// *before* the job is approved. Must be called after `strongbox.setPayee(jobId,
    /// address(this))` -- reverts if this contract isn't (yet) the job's payee in the Strongbox,
    /// so a job can never be registered against the wrong Splitter instance.
    function registerJob(bytes32 jobId, address patronPool) external onlyCouncil {
        if (patronPool == address(0)) revert ZeroAddress();
        if (_splits[jobId].amount != 0) revert JobAlreadyRegistered();

        WageholdStrongbox.Job memory job = strongbox.getJob(jobId);
        if (job.status != WageholdStrongbox.Status.Open) revert JobNotOpenInStrongbox();
        if (job.payee != address(this)) revert PayeeMismatch();

        _splits[jobId] = SplitJob({patronPool: patronPool, amount: job.amount, split: false});

        emit JobRegistered(jobId, patronPool, job.amount);
    }

    // ---------------------------------------------------------------------
    // Permissionless action
    // ---------------------------------------------------------------------

    /// @notice Pulls this contract's approved balance from the Strongbox (if any is waiting)
    /// and credits `jobId`'s registered amount to Patrons / Lamp Oil / Tithe by pull-payment and books
    /// the Furnace share in `pendingBurn`.
    /// Callable by anyone: it only ever moves a registered job's own wage to the fixed
    /// destinations recorded at `registerJob` time, so there is nothing for an arbitrary caller
    /// to redirect.
    /// @dev Re-checks `job.payee == address(this)` against the Strongbox's current state, not
    /// just what was true at registration -- `WageholdStrongbox.setPayee` has no guard against
    /// being called again on a still-`Open` job, so in principle `council` could reassign a job
    /// away from this Splitter after registering it here but before it's approved. Once a job
    /// reaches `Released` its payee can no longer change (Strongbox only lets `setPayee` touch
    /// `Open` jobs), so this check is exact, not just a best effort.
    function pullAndSplit(bytes32 jobId) external nonReentrant {
        SplitJob storage sj = _splits[jobId];
        if (sj.amount == 0) revert JobNotRegistered();
        if (sj.split) revert JobAlreadySplit();

        // What the Strongbox actually credited this contract for the job: the full wage after
        // `approve`, only the payee's share after a partial `resolveDispute`, 0 after a full
        // refund. Splitting this (not the `registerJob` snapshot) keeps the ledger exactly
        // backed by tokens -- finding S5 was crediting the snapshot (100) when only 60 arrived.
        uint256 amount;
        {
            WageholdStrongbox.Job memory job = strongbox.getJob(jobId);
            if (job.status != WageholdStrongbox.Status.Released) revert JobNotReleasedYet();
            if (job.payee != address(this)) revert PayeeChangedSinceRegistration();
            amount = strongbox.releasedToPayee(jobId);
        }

        uint256 patronAmount = (amount * PATRON_BPS) / BPS_DENOM;
        uint256 lampOilAmount = (amount * LAMP_OIL_BPS) / BPS_DENOM;
        uint256 burnAmount = (amount * FURNACE_BPS) / BPS_DENOM;
        // Remainder (integer-division dust, at most a few base units) goes to the Tithe rather
        // than being split further or left stranded. Same rule as the app's
        // `record_wage_split` (migration 0013), so on-chain and recorded numbers agree.
        uint256 titheAmount = amount - patronAmount - lampOilAmount - burnAmount;

        // All effects -- including the event -- happen before the external calls below.
        sj.split = true;
        pendingWithdrawals[sj.patronPool] += patronAmount;
        pendingWithdrawals[lampOilTreasury] += lampOilAmount;
        pendingWithdrawals[titheTreasury] += titheAmount;
        pendingBurn += burnAmount;

        emit JobSplit(jobId, sj.patronPool, patronAmount, lampOilAmount, titheAmount, burnAmount);

        _pullFromStrongboxIfNeeded();
        _tryBurn();
    }

    /// @dev Pulls this contract's entire pending balance out of the Strongbox in one go when
    /// there is one, rather than reverting when a previous `pullAndSplit` call already pulled
    /// enough to cover this job too (e.g. two jobs approved back-to-back before either was
    /// split). `WageholdStrongbox.withdraw()` reverts on a zero balance, so this only calls it
    /// when there's actually something waiting.
    function _pullFromStrongboxIfNeeded() private {
        if (strongbox.pendingWithdrawals(address(this)) > 0) {
            strongbox.withdraw();
        }
    }

    // ---------------------------------------------------------------------
    // Withdrawals (pull-payment)
    // ---------------------------------------------------------------------

    /// @notice Pulls the caller's full pending balance -- a Patron pool, `lampOilTreasury`, or
    /// `titheTreasury` calling on their own behalf.
    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        pendingWithdrawals[msg.sender] = 0;
        wageToken.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount);
    }

    /// @dev Automatic burn, run at the end of every `pullAndSplit`. Best effort by design: if the
    /// token refuses the transfer (pause, blacklist of the dead address, ...) the split must
    /// still succeed, so a failure restores the books and leaves `pendingBurn` for a later manual
    /// `burn()`. Only reached after `_pullFromStrongboxIfNeeded`, when every split job's wage is
    /// in this contract, so `pendingBurn` is always fully backed by its token balance.
    function _tryBurn() private {
        uint256 amount = pendingBurn;
        if (amount == 0) return;

        pendingBurn = 0;
        totalBurned += amount;

        (bool ok, bytes memory ret) =
            address(wageToken).call(abi.encodeCall(IERC20.transfer, (BURN_ADDRESS, amount)));
        bool success = ok && (ret.length == 0 || (ret.length >= 32 && abi.decode(ret, (bool))));

        if (success) {
            emit Burned(msg.sender, amount);
        } else {
            pendingBurn = amount;
            totalBurned -= amount;
        }
    }

    /// @notice Manual burn of any Furnace share the automatic burn could not send (for example
    /// because the token was paused at the time). Permissionless: the destination is a constant,
    /// so a caller can only ever burn, never redirect. Reverts if the token still refuses.
    function burn() external nonReentrant {
        uint256 amount = pendingBurn;
        if (amount == 0) revert NothingToBurn();

        pendingBurn = 0;
        totalBurned += amount;
        wageToken.safeTransfer(BURN_ADDRESS, amount);

        emit Burned(msg.sender, amount);
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function setCouncil(address newCouncil) external onlyOwner {
        if (newCouncil == address(0)) revert ZeroAddress();
        council = newCouncil;
        emit CouncilUpdated(newCouncil);
    }

    function setOwner(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        owner = newOwner;
        emit OwnerUpdated(newOwner);
    }

    function setLampOilTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        lampOilTreasury = newTreasury;
        emit LampOilTreasuryUpdated(newTreasury);
    }

    function setTitheTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        titheTreasury = newTreasury;
        emit TitheTreasuryUpdated(newTreasury);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getSplit(bytes32 jobId) external view returns (SplitJob memory) {
        return _splits[jobId];
    }
}
