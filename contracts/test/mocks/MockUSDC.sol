// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Mint-by-anyone ERC20 standing in for USDC (6 decimals) in tests.
/// @dev Test-only by design (open `mint()`) -- safe for `forge test` and for testnet-only runs
/// of `script/Deploy.s.sol` (used when `WAGE_TOKEN_ADDRESS` is left unset). Never deploy this
/// as the real `wageToken` on mainnet -- anyone could mint themselves unlimited wages.
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USD Coin", "mUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
