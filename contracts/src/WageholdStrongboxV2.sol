// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title WageholdStrongboxV2
/// @notice Escrow for job wages, v2 (Patronage brief H2 + H3). Same job lifecycle and the same ABI
/// for everything `WageholdSplitterV2` and the app read (`getJob`, `releasedToPayee`,
/// `pendingWithdrawals`, `withdraw`, `Status`, `Job`), with the single v1 `council` split in two:
///
///   * `registrar` -- a server-held hot key. Its ONLY power is `setPayee`, and `setPayee` can only
///     point a job at an address on the `allowedPayee` list (in practice: Splitter v2). A leaked
///     registrar key cannot redirect a wage to an arbitrary address (H3) and has no dispute power
///     (H2).
///   * `council` -- a Safe multisig. Its ONLY power is `resolveDispute`. It cannot set payees.
///   * `owner` -- a timelock behind the Safe. Manages the roles and the payee allow-list.
///
/// Charter guarantees are unchanged: only the job's own client can `approve` (Article I), no role is
/// agent-controlled (Article II), `createJob` pulls the wage in the same call (Article III), every
/// state change emits an event (Article IV). No function lets any role move escrowed funds except
/// `approve` (client), `refund` (client) and `resolveDispute` (council, bounded to the payee and the
/// client of that one job).
///
/// Migration (brief section 5): new jobs use this Strongbox -> Splitter v2. Jobs already escrowed in
/// Strongbox v1 finish on v1. Nothing is force-migrated.
///
/// Differences from v1:
///   * `setPayee(jobId, payee)` keeps v1's signature so the app ABI is unchanged, but reverts
///     `PayeeNotAllowed` for any address not on the allow-list. A job can still be re-pointed while
///     `Open`, only among allowed payees.
///   * ownership is two-step (`transferOwnership` + `acceptOwnership`).
///   * `resolveDispute` refuses to pay a payee when none was ever set.
contract WageholdStrongboxV2 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev Order MUST match `WageholdStrongbox.Status` (v1): `WageholdSplitterV2` decodes it as v1's.
    enum Status {
        None,
        Open,
        Released,
        Refunded,
        Disputed
    }

    /// @dev Field order MUST match `WageholdStrongbox.Job` (v1), for the same reason.
    struct Job {
        address client;
        address payee;
        uint256 amount;
        Status status;
    }

    IERC20 public immutable wageToken;

    /// @notice Safe multisig. Resolves disputes. Cannot set payees.
    address public council;
    /// @notice Hot key. Sets payees from the allow-list only. No dispute power.
    address public registrar;
    address public owner;
    address public pendingOwner;

    /// @notice Addresses a job's payee may be set to. Managed by `owner` (timelocked).
    mapping(address => bool) public allowedPayee;

    mapping(bytes32 => Job) private _jobs;
    mapping(address => uint256) public pendingWithdrawals;
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
    event RegistrarUpdated(address indexed newRegistrar);
    event AllowedPayeeUpdated(address indexed payee, bool allowed);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnerUpdated(address indexed newOwner);

    error ZeroAddress();
    error ZeroAmount();
    error JobAlreadyExists();
    error JobNotFound();
    error InvalidStatus();
    error NotClient();
    error NotCouncil();
    error NotRegistrar();
    error NotOwner();
    error NotPendingOwner();
    error PayeeAlreadySet();
    error PayeeNotSet();
    error PayeeNotAllowed();
    error SplitMismatch();
    error NothingToWithdraw();
    error CouncilIsRegistrar();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyCouncil() {
        if (msg.sender != council) revert NotCouncil();
        _;
    }

    modifier onlyRegistrar() {
        if (msg.sender != registrar) revert NotRegistrar();
        _;
    }

    constructor(IERC20 _wageToken, address _council, address _registrar, address _owner) {
        if (
            address(_wageToken) == address(0) || _council == address(0) || _registrar == address(0)
                || _owner == address(0)
        ) {
            revert ZeroAddress();
        }
        // The whole point of the split: the hot key must not be the dispute key.
        if (_council == _registrar) revert CouncilIsRegistrar();

        wageToken = _wageToken;
        council = _council;
        registrar = _registrar;
        owner = _owner;
    }

    // ---------------------------------------------------------------------
    // Client actions (identical to v1)
    // ---------------------------------------------------------------------

    function createJob(bytes32 jobId, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (_jobs[jobId].status != Status.None) revert JobAlreadyExists();

        _jobs[jobId] =
            Job({client: msg.sender, payee: address(0), amount: amount, status: Status.Open});

        wageToken.safeTransferFrom(msg.sender, address(this), amount);

        emit JobFunded(jobId, msg.sender, amount);
    }

    /// @notice "Set the seal": only the job's own client (Charter I).
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

    function dispute(bytes32 jobId) external {
        Job storage job = _jobs[jobId];
        if (job.status == Status.None) revert JobNotFound();
        if (job.status != Status.Open) revert InvalidStatus();
        if (msg.sender != job.client) revert NotClient();

        job.status = Status.Disputed;
        emit SealBroken(jobId, msg.sender);
    }

    // ---------------------------------------------------------------------
    // Registrar action (H2 + H3)
    // ---------------------------------------------------------------------

    /// @notice Wires the on-chain payee for an `Open` job. `payee` must be on the allow-list, so a
    /// compromised registrar key can only ever route wages into the Splitter path.
    function setPayee(bytes32 jobId, address payee) external onlyRegistrar {
        Job storage job = _jobs[jobId];
        if (job.status == Status.None) revert JobNotFound();
        if (job.status != Status.Open) revert InvalidStatus();
        if (payee == address(0)) revert ZeroAddress();
        if (!allowedPayee[payee]) revert PayeeNotAllowed();

        job.payee = payee;
        emit PayeeSet(jobId, payee);
    }

    // ---------------------------------------------------------------------
    // Council action (H2): disputes only
    // ---------------------------------------------------------------------

    /// @notice Splits a disputed job's escrow between its payee and its client. The two amounts
    /// must sum to the escrowed amount: a dispute moves money between the two parties of THAT job
    /// and can never create, destroy or redirect it.
    function resolveDispute(bytes32 jobId, uint256 payeeAmount, uint256 refundAmount)
        external
        onlyCouncil
        nonReentrant
    {
        Job storage job = _jobs[jobId];
        if (job.status == Status.None) revert JobNotFound();
        if (job.status != Status.Disputed) revert InvalidStatus();
        if (payeeAmount + refundAmount != job.amount) revert SplitMismatch();
        // A disputed job with no payee has nobody to pay; only a full refund is coherent.
        if (payeeAmount != 0 && job.payee == address(0)) revert PayeeNotSet();

        job.status = Status.Released;
        _releasedToPayee[jobId] = payeeAmount;
        if (payeeAmount > 0) pendingWithdrawals[job.payee] += payeeAmount;
        if (refundAmount > 0) pendingWithdrawals[job.client] += refundAmount;

        emit DisputeResolved(jobId, job.payee, payeeAmount, refundAmount);
    }

    // ---------------------------------------------------------------------
    // Withdrawals (pull-payment)
    // ---------------------------------------------------------------------

    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        pendingWithdrawals[msg.sender] = 0;
        wageToken.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount);
    }

    // ---------------------------------------------------------------------
    // Owner (timelock behind the Safe)
    // ---------------------------------------------------------------------

    function setCouncil(address newCouncil) external onlyOwner {
        if (newCouncil == address(0)) revert ZeroAddress();
        if (newCouncil == registrar) revert CouncilIsRegistrar();
        council = newCouncil;
        emit CouncilUpdated(newCouncil);
    }

    function setRegistrar(address newRegistrar) external onlyOwner {
        if (newRegistrar == address(0)) revert ZeroAddress();
        if (newRegistrar == council) revert CouncilIsRegistrar();
        registrar = newRegistrar;
        emit RegistrarUpdated(newRegistrar);
    }

    /// @notice Adds or removes an address from the payee allow-list. Removing only affects future
    /// `setPayee` calls; a job already pointed at it keeps its payee.
    function setAllowedPayee(address payee, bool allowed) external onlyOwner {
        if (payee == address(0)) revert ZeroAddress();
        allowedPayee[payee] = allowed;
        emit AllowedPayeeUpdated(payee, allowed);
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

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function releasedToPayee(bytes32 jobId) external view returns (uint256) {
        return _releasedToPayee[jobId];
    }

    function getJob(bytes32 jobId) external view returns (Job memory) {
        return _jobs[jobId];
    }
}
