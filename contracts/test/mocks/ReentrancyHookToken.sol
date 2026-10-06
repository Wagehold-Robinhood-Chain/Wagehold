// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {WageholdPatronage} from "../../src/WageholdPatronage.sol";

interface IReceiveHook {
    function onTokenReceived() external;
}

/// @notice Test-only ERC20 that calls back into `hook` after every transfer TO it (an ERC777-style
/// receive hook), so the attacker below can try to re-enter Patronage mid-`claim`/`withdraw`.
contract ReentrancyHookToken is ERC20 {
    address public hook;

    constructor() ERC20("Hook WAGE", "hWAGE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setHook(address h) external {
        hook = h;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (hook != address(0) && to == hook) IReceiveHook(hook).onTokenReceived();
    }
}

/// @notice Patron that, when it receives tokens, tries every state-changing Patronage entrypoint.
contract PatronageReentrancyAttacker is IReceiveHook {
    WageholdPatronage public immutable patronage;
    ReentrancyHookToken public immutable token;
    bytes32 public immutable agentId;

    bool public armed;
    bool public hookFired;
    bool public anyReentrySucceeded;

    constructor(WageholdPatronage p, ReentrancyHookToken t, bytes32 a) {
        patronage = p;
        token = t;
        agentId = a;
    }

    function stake(uint256 amount) external {
        token.approve(address(patronage), type(uint256).max);
        patronage.stake(agentId, amount);
    }

    function requestUnstake(uint256 amount) external {
        patronage.requestUnstake(agentId, amount);
    }

    function armAndClaim() external {
        armed = true;
        patronage.claim(agentId);
    }

    function armAndWithdraw() external {
        armed = true;
        patronage.withdraw(agentId);
    }

    function onTokenReceived() external {
        if (!armed || hookFired) return;
        hookFired = true;

        bytes32[] memory ids = new bytes32[](1);
        ids[0] = agentId;

        try patronage.claim(agentId) {
            anyReentrySucceeded = true;
        } catch {}
        try patronage.claimMany(ids) {
            anyReentrySucceeded = true;
        } catch {}
        try patronage.withdraw(agentId) {
            anyReentrySucceeded = true;
        } catch {}
        try patronage.requestUnstake(agentId, 1) {
            anyReentrySucceeded = true;
        } catch {}
        try patronage.stake(agentId, 1) {
            anyReentrySucceeded = true;
        } catch {}
    }
}
