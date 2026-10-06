// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test-only 18-decimal stand-in for $WAGE. Open `mint()`, and transfers to any address
/// flagged with `setBlocked` revert (to prove Patronage/Splitter keep working when the token
/// refuses a destination). Never deploy as the real wage token.
contract MockWAGE is ERC20 {
    mapping(address => bool) public blocked;

    constructor() ERC20("Mock WAGE", "mWAGE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setBlocked(address who, bool on) external {
        blocked[who] = on;
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!blocked[to], "recipient blocked");
        super._update(from, to, value);
    }
}
