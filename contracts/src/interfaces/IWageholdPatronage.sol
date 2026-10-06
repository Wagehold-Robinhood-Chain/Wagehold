// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice The slice of `WageholdPatronage` that `WageholdSplitterV2` depends on.
interface IWageholdPatronage {
    /// @notice Credits `amount` of $WAGE (already transferred to Patronage) to `agentId`'s patrons,
    /// or routes it to the treasury when the building has no stakers. Splitter-only.
    function notifyReward(bytes32 agentId, bytes32 jobId, uint256 amount) external;

    /// @notice Whether `agentId` is a registered building (can accept new stakes).
    function isBuilding(bytes32 agentId) external view returns (bool);
}
