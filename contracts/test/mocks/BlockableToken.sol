// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test-only 6-decimal ERC20 whose transfers to one chosen address can be switched off,
/// to prove `WageholdSplitter` keeps splitting when the token refuses the automatic burn.
contract BlockableToken is ERC20 {
    address public blockedRecipient;
    bool public blocked;

    constructor() ERC20("Blockable USD", "bUSD") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setBlock(address recipient, bool on) external {
        blockedRecipient = recipient;
        blocked = on;
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!(blocked && to == blockedRecipient), "recipient blocked");
        super._update(from, to, value);
    }
}
