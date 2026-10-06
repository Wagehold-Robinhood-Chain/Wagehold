// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

/// @title WageholdTimelock
/// @notice OpenZeppelin's audited `TimelockController` with one Wagehold rule added: the effective
/// delay can never be below 24 hours (brief H4: 24-48h on `setSplitter`, `setCooldown`, treasury
/// setters, the payee allow-list and role rotation). It becomes the `owner` of Patronage, Splitter
/// v2 and Strongbox v2; the Safe multisig is its proposer (and canceller), and anyone may execute
/// once the delay has passed, so a stuck signer set cannot freeze a queued, already-announced change.
/// @dev Deploy with `admin = address(0)`: the timelock then administers itself, so changing the
/// proposers or the delay is itself a delayed operation. Do not pass an admin EOA.
///
/// The floor is enforced by overriding `getMinDelay()`: `schedule` and `scheduleBatch` both compare
/// the requested delay against it, so even if `updateDelay` were later queued with a value below
/// 24h, no operation could be scheduled with less than 24h. (`updateDelay` itself is left exactly as
/// OpenZeppelin ships it.)
contract WageholdTimelock is TimelockController {
    uint256 public constant MIN_DELAY_FLOOR = 24 hours;

    error DelayBelowFloor(uint256 delay);

    constructor(
        uint256 minDelay,
        address[] memory proposers,
        address[] memory executors,
        address admin
    ) TimelockController(minDelay, proposers, executors, admin) {
        if (minDelay < MIN_DELAY_FLOOR) revert DelayBelowFloor(minDelay);
    }

    /// @inheritdoc TimelockController
    function getMinDelay() public view override returns (uint256) {
        uint256 d = super.getMinDelay();
        return d < MIN_DELAY_FLOOR ? MIN_DELAY_FLOOR : d;
    }
}
