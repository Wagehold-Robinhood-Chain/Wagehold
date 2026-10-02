// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title WageholdStrongbox
/// @notice The Strongbox: escrow for job wages (Fase 2 item 1 -- `wagehold-handoff.md` §6.2).
/// @dev Charter (`wagehold-lore.md` §3) mapped to code:
///
///   Article I   -- "No coin leaves the Hold without a human seal."
///                  `approve` is the only path that ever credits a payee, and only the
///                  job's own client (a human, wallet-connected) may call it.
///   Article II  -- "A Wright never holds the key."
///                  There is no agent-controlled role anywhere in this contract. The Warden's
///                  off-chain assignment only reaches the chain through `setPayee`, called by
///                  `council` (an operator key controlled by the team, never an LLM).
///   Article III -- "The wage enters before the work begins."
///                  `createJob` pulls the ERC20 transfer in the same call that opens the job --
///                  if the call returns, the wage is already inside the Strongbox.
///   Article IV  -- "Every hand leaves a mark."
///                  Every state change emits an event.
///
/// Scope note: this contract only holds and releases the wage. Splitting a released wage
/// 60/20/10/10 (Patrons / Lamp Oil / Tithe / Furnace) is `WageholdSplitter` (Fase 2 item 2) -- `approve`
/// simply credits whatever `payee` address was set for the job, which will *be* the Splitter
/// once item 2 exists. Nothing here needs to change when that lands.
///
/// `jobId` is caller-supplied (not an internal counter) so the off-chain Postgres `jobs.id`
/// (a UUID) can map 1:1 onto it -- the intended convention is
/// `jobId = keccak256(bytes(uuidString))`, computed off-chain when `POST /api/jobs` is wired
/// to lock the wage on-chain (Fase 2 item 6). This contract never inspects the bytes, so any
/// convention works as long as the caller is consistent.
contract WageholdStrongbox is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        None, // job does not exist
        Open, // wage locked, awaiting payee assignment and/or the seal
        Released, // seal set (or dispute resolved) -- wage credited to payee/client, no further action
        Refunded, // cancelled before assignment -- wage credited back to client
        Disputed // seal broken -- frozen until the Council resolves it

    }

    struct Job {
        address client; // who posted the job and funded the wage
        address payee; // who receives the wage on approval -- set by `setPayee`, empty until assigned
        uint256 amount; // the wage, in `wageToken` base units
        Status status;
    }

    /// @notice The ERC20 wages are denominated in (USDC on Base per `wagehold-handoff.md` §6).
    IERC20 public immutable wageToken;

    /// @notice Placeholder for `WageholdCouncil` (Fase 3+, `wagehold-lore.md` §5): an operator
    /// address (EOA or Safe multisig) that assigns payees and resolves disputes until real
    /// on-chain governance exists. Never an agent's own address (Charter II).
    address public council;

    /// @notice Contract admin: can rotate `owner`/`council`. A Safe multisig in production,
    /// never an agent (Charter II). Hand-rolled instead of importing OpenZeppelin's `Ownable`
    /// so this contract has one fewer external dependency whose constructor signature has
    /// changed across major OpenZeppelin versions (v4 vs v5) -- the two-function admin surface
    /// here does not need it.
    address public owner;

    mapping(bytes32 => Job) private _jobs;

    /// @notice Pull-payment ledger (`wagehold-handoff.md` §6.3 pattern, applied here too): a
    /// released/refunded amount is credited here, not pushed, so a misbehaving `payee` contract
    /// can never block `approve`/`resolveDispute` from completing, and `withdraw` alone is the
    /// only place tokens actually leave the contract to an external address.
    mapping(address => uint256) public pendingWithdrawals;

    /// @notice What a job actually credited to its payee: the full wage on `approve`, only the
    /// payee's share on `resolveDispute` (0 on a full refund). `WageholdSplitter` splits THIS
    /// amount, never the original wage, so a partial dispute can't make it credit more than it
    /// receives (finding S5). Meaningful once `status == Released`; 0 before that.
    mapping(bytes32 => uint256) private _releasedToPayee;

    event JobFunded(bytes32 indexed jobId, address indexed client, uint256 amount);
    event PayeeSet(bytes32 indexed jobId, address indexed payee);
    event SealSet(bytes32 indexed jobId, address indexed payee, uint256 amount);
    event JobRefunded(bytes32 indexed jobId, address indexed client, uint256 amount);
    event SealBroken(bytes32 indexed jobId, address indexed client);
    event DisputeResolved(
        bytes32 indexed jobId, address indexed payee, uint256 payeeAmount, uint256 refundAmount
    );
    event Withdrawn(address indexed to, uint256 amount);
    event CouncilUpdated(address indexed newCouncil);
    event OwnerUpdated(address indexed newOwner);

    error ZeroAddress();
    error ZeroAmount();
    error JobAlreadyExists();
    error JobNotFound();
    error InvalidStatus();
    error NotClient();
    error NotCouncil();
    error NotOwner();
    error PayeeAlreadySet();
    error PayeeNotSet();
    error SplitMismatch();
    error NothingToWithdraw();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyCouncil() {
        if (msg.sender != council) revert NotCouncil();
        _;
    }

    constructor(IERC20 _wageToken, address _council, address _owner) {
        if (address(_wageToken) == address(0) || _council == address(0) || _owner == address(0)) {
            revert ZeroAddress();
        }
        wageToken = _wageToken;
        council = _council;
        owner = _owner;
    }

    // ---------------------------------------------------------------------
    // Client actions
    // ---------------------------------------------------------------------

    /// @notice "Post a job": locks `amount` of `wageToken` from the caller under `jobId`.
    /// @dev Reverts on a reused `jobId` rather than overwriting, so a client can never
    /// accidentally (or maliciously) clobber an existing escrow. The caller must have already
    /// `approve`d this contract for at least `amount` on `wageToken`.
    function createJob(bytes32 jobId, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (_jobs[jobId].status != Status.None) revert JobAlreadyExists();

        _jobs[jobId] =
            Job({client: msg.sender, payee: address(0), amount: amount, status: Status.Open});

        // Effects are written above before this external call (checks-effects-interactions);
        // `nonReentrant` guards it regardless.
        wageToken.safeTransferFrom(msg.sender, address(this), amount);

        emit JobFunded(jobId, msg.sender, amount);
    }

    /// @notice "Set the seal": the client releases the wage to whichever payee was assigned.
    /// Only the job's own client may call this (Charter I) -- not the payee, not the council,
    /// not this contract's owner.
    function approve(bytes32 jobId) external nonReentrant {
        Job storage job = _jobs[jobId];
        if (job.status == Status.None) revert JobNotFound();
        if (job.status != Status.Open) revert InvalidStatus();
        if (msg.sender != job.client) revert NotClient();
        if (job.payee == address(0)) revert PayeeNotSet();

        job.status = Status.Released;
        _releasedToPayee[jobId] = job.amount;
        pendingWithdrawals[job.payee] += job.amount;

        emit SealSet(jobId, job.payee, job.amount);
    }

    /// @notice Client cancels before any Wright is assigned -- full refund. Once a payee is set
    /// the job can no longer be silently cancelled; use `dispute` instead so the Council sees it.
    function refund(bytes32 jobId) external nonReentrant {
        Job storage job = _jobs[jobId];
        if (job.status == Status.None) revert JobNotFound();
        if (job.status != Status.Open) revert InvalidStatus();
        if (msg.sender != job.client) revert NotClient();
        if (job.payee != address(0)) revert PayeeAlreadySet();

        job.status = Status.Refunded;
        pendingWithdrawals[job.client] += job.amount;

        emit JobRefunded(jobId, job.client, job.amount);
    }

    /// @notice "Break the seal": the client disputes an assigned job instead of approving it.
    /// Matches the state machine in `wagehold-handoff.md` §5 exactly -- only the client
    /// transitions a job to `disputed`; the payee side is heard when the Council resolves it.
    function dispute(bytes32 jobId) external {
        Job storage job = _jobs[jobId];
        if (job.status == Status.None) revert JobNotFound();
        if (job.status != Status.Open) revert InvalidStatus();
        if (msg.sender != job.client) revert NotClient();

        job.status = Status.Disputed;
        emit SealBroken(jobId, msg.sender);
    }

    // ---------------------------------------------------------------------
    // Council actions (placeholder for WageholdCouncil, Fase 3+)
    // ---------------------------------------------------------------------

    /// @notice Wires the on-chain payee for a job once the Warden assigns a Wright off-chain
    /// (Fase 1). Never callable by the client or by an agent -- only `council`.
    function setPayee(bytes32 jobId, address payee) external onlyCouncil {
        Job storage job = _jobs[jobId];
        if (job.status == Status.None) revert JobNotFound();
        if (job.status != Status.Open) revert InvalidStatus();
        if (payee == address(0)) revert ZeroAddress();

        job.payee = payee;
        emit PayeeSet(jobId, payee);
    }

    /// @notice Resolves a disputed job by splitting its wage between the payee and a refund to
    /// the client. `payeeAmount + refundAmount` must equal the job's full escrowed amount --
    /// a dispute can move money between the two parties, never create or destroy it.
    function resolveDispute(bytes32 jobId, uint256 payeeAmount, uint256 refundAmount)
        external
        onlyCouncil
        nonReentrant
    {
        Job storage job = _jobs[jobId];
        if (job.status == Status.None) revert JobNotFound();
        if (job.status != Status.Disputed) revert InvalidStatus();
        if (payeeAmount + refundAmount != job.amount) revert SplitMismatch();

        job.status = Status.Released;
        _releasedToPayee[jobId] = payeeAmount;
        if (payeeAmount > 0) pendingWithdrawals[job.payee] += payeeAmount;
        if (refundAmount > 0) pendingWithdrawals[job.client] += refundAmount;

        emit DisputeResolved(jobId, job.payee, payeeAmount, refundAmount);
    }

    // ---------------------------------------------------------------------
    // Withdrawals (pull-payment)
    // ---------------------------------------------------------------------

    /// @notice Pulls the caller's full pending balance. Anyone can hold a pending balance --
    /// a client (refund / dispute refund share), a payee (approved wage / dispute payee share),
    /// or, once Fase 2 item 2 lands, a `WageholdSplitter` contract acting as a job's payee.
    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        pendingWithdrawals[msg.sender] = 0;
        wageToken.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount);
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

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice Amount credited to the job's payee when it was released (see `_releasedToPayee`).
    function releasedToPayee(bytes32 jobId) external view returns (uint256) {
        return _releasedToPayee[jobId];
    }

    function getJob(bytes32 jobId) external view returns (Job memory) {
        return _jobs[jobId];
    }
}
