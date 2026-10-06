// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {WageholdStrongbox} from "./WageholdStrongbox.sol";
import {IWageholdPatronage} from "./interfaces/IWageholdPatronage.sol";

/// @title WageholdSplitterV2
/// @notice Splits a released wage 60/20/10/10 like `WageholdSplitter` (v1), but the 60% patron cut
/// goes to `WageholdPatronage` for the job's building (`agentId`) instead of to a free-form
/// address. New jobs use Strongbox -> Splitter v2; jobs already registered on v1 finish on v1.
/// @dev Differences from v1:
///   * `registerJob(jobId, agentId)` stores the building. The patron destination is no longer an
///     address chosen by the caller: it is always `patronage`, credited for `agentId`, and
///     `agentId` must be a building registered in Patronage (partial H3).
///   * The patron share is transferred to Patronage and `notifyReward` is called in the same
///     transaction, so the cut can never be "sent but not credited" or "credited but not sent".
///   * `council` is replaced by `registrar`: a hot key that can ONLY register jobs here. It has
///     no dispute power (H2). Note the Strongbox v1 `setPayee` is still `council`-only; fully
///     removing that power needs Strongbox v2.
///   * If `notifyReward` reverts (e.g. Patronage does not recognise this Splitter), the whole
///     `pullAndSplit` reverts and nothing is half-applied; funds stay in the Strongbox/Splitter
///     and the call can be retried once fixed.
/// Lamp Oil and Tithe stay pull-payments, and the Furnace burn stays best-effort, exactly as v1.
contract WageholdSplitterV2 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant PATRON_BPS = 6_000;
    uint256 public constant LAMP_OIL_BPS = 2_000;
    uint256 public constant TITHE_BPS = 1_000;
    uint256 public constant FURNACE_BPS = 1_000;
    uint256 public constant BPS_DENOM = 10_000;

    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    struct SplitJob {
        bytes32 agentId; // building whose patrons get this job's 60%
        uint256 amount; // snapshot of the job's wage at registration time
        bool split; // true once pullAndSplit has run
    }

    IERC20 public immutable wageToken;
    WageholdStrongbox public immutable strongbox;
    IWageholdPatronage public immutable patronage;

    /// @notice Hot key (server) that may only call `registerJob`.
    address public registrar;
    address public owner;
    address public pendingOwner;
    address public lampOilTreasury;
    address public titheTreasury;

    mapping(bytes32 => SplitJob) private _splits;
    mapping(address => uint256) public pendingWithdrawals;
    uint256 public pendingBurn;
    uint256 public totalBurned;

    event JobRegistered(bytes32 indexed jobId, bytes32 indexed agentId, uint256 amount);
    event JobSplit(
        bytes32 indexed jobId,
        bytes32 indexed agentId,
        uint256 patronAmount,
        uint256 lampOilAmount,
        uint256 titheAmount,
        uint256 burnAmount
    );
    event Withdrawn(address indexed to, uint256 amount);
    event Burned(address indexed caller, uint256 amount);
    event RegistrarUpdated(address indexed newRegistrar);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnerUpdated(address indexed newOwner);
    event LampOilTreasuryUpdated(address indexed newTreasury);
    event TitheTreasuryUpdated(address indexed newTreasury);

    error ZeroAddress();
    error ZeroAgentId();
    error NotRegistrar();
    error NotOwner();
    error NotPendingOwner();
    error BuildingNotRegistered();
    error JobNotOpenInStrongbox();
    error PayeeMismatch();
    error JobAlreadyRegistered();
    error JobNotRegistered();
    error JobAlreadySplit();
    error JobNotReleasedYet();
    error PayeeChangedSinceRegistration();
    error NothingToWithdraw();
    error NothingToBurn();

    modifier onlyRegistrar() {
        if (msg.sender != registrar) revert NotRegistrar();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(
        IERC20 _wageToken,
        WageholdStrongbox _strongbox,
        IWageholdPatronage _patronage,
        address _registrar,
        address _owner,
        address _lampOilTreasury,
        address _titheTreasury
    ) {
        if (
            address(_wageToken) == address(0) || address(_strongbox) == address(0)
                || address(_patronage) == address(0) || _registrar == address(0)
                || _owner == address(0) || _lampOilTreasury == address(0)
                || _titheTreasury == address(0)
        ) {
            revert ZeroAddress();
        }

        wageToken = _wageToken;
        strongbox = _strongbox;
        patronage = _patronage;
        registrar = _registrar;
        owner = _owner;
        lampOilTreasury = _lampOilTreasury;
        titheTreasury = _titheTreasury;
    }

    // ---------------------------------------------------------------------
    // Registrar action
    // ---------------------------------------------------------------------

    /// @notice Snapshots `jobId`'s wage and binds it to building `agentId`, before the job is
    /// approved. Requires this contract to already be the job's payee in the Strongbox and
    /// `agentId` to be a registered building in Patronage.
    function registerJob(bytes32 jobId, bytes32 agentId) external onlyRegistrar {
        if (agentId == bytes32(0)) revert ZeroAgentId();
        if (!patronage.isBuilding(agentId)) revert BuildingNotRegistered();
        if (_splits[jobId].amount != 0) revert JobAlreadyRegistered();

        WageholdStrongbox.Job memory job = strongbox.getJob(jobId);
        if (job.status != WageholdStrongbox.Status.Open) revert JobNotOpenInStrongbox();
        if (job.payee != address(this)) revert PayeeMismatch();

        _splits[jobId] = SplitJob({agentId: agentId, amount: job.amount, split: false});

        emit JobRegistered(jobId, agentId, job.amount);
    }

    // ---------------------------------------------------------------------
    // Permissionless action
    // ---------------------------------------------------------------------

    /// @notice Pulls this contract's approved balance from the Strongbox (if any), sends the
    /// patron cut to Patronage and notifies it, credits Lamp Oil / Tithe by pull-payment, and
    /// burns the Furnace share. Callable by anyone: every destination is fixed at registration
    /// (Patronage for the registered building, the two treasuries, the dead address).
    /// @dev Splits what the Strongbox actually released to this contract (full wage after
    /// `approve`, the payee share after `resolveDispute`), not the registration snapshot.
    function pullAndSplit(bytes32 jobId) external nonReentrant {
        SplitJob storage sj = _splits[jobId];
        if (sj.amount == 0) revert JobNotRegistered();
        if (sj.split) revert JobAlreadySplit();

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
        uint256 titheAmount = amount - patronAmount - lampOilAmount - burnAmount;

        // Effects (and the event) before any external call.
        sj.split = true;
        pendingWithdrawals[lampOilTreasury] += lampOilAmount;
        pendingWithdrawals[titheTreasury] += titheAmount;
        pendingBurn += burnAmount;

        bytes32 agentId = sj.agentId;
        emit JobSplit(jobId, agentId, patronAmount, lampOilAmount, titheAmount, burnAmount);

        // slither-disable-next-line reentrancy-no-eth
        _pullFromStrongboxIfNeeded();

        if (patronAmount != 0) {
            wageToken.safeTransfer(address(patronage), patronAmount);
            patronage.notifyReward(agentId, jobId, patronAmount);
        }

        // slither-disable-next-line reentrancy-no-eth
        _tryBurn();
    }

    function _pullFromStrongboxIfNeeded() private {
        if (strongbox.pendingWithdrawals(address(this)) > 0) {
            strongbox.withdraw();
        }
    }

    // ---------------------------------------------------------------------
    // Withdrawals (pull-payment) and burn
    // ---------------------------------------------------------------------

    /// @notice Lamp Oil / Tithe treasuries pull their pending balance.
    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        pendingWithdrawals[msg.sender] = 0;
        wageToken.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount);
    }

    function _tryBurn() private {
        uint256 amount = pendingBurn;
        if (amount == 0) return;

        pendingBurn = 0;
        totalBurned += amount;

        // The callee is the trusted $WAGE token; pullAndSplit, burn and withdraw are all nonReentrant.
        // slither-disable-next-line reentrancy-no-eth
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

    /// @notice Retries a Furnace share the automatic burn could not send. Permissionless: the
    /// destination is a constant.
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

    function setRegistrar(address newRegistrar) external onlyOwner {
        if (newRegistrar == address(0)) revert ZeroAddress();
        registrar = newRegistrar;
        emit RegistrarUpdated(newRegistrar);
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
