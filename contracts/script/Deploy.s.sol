// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {WageholdStrongbox} from "../src/WageholdStrongbox.sol";
import {WageholdSplitter} from "../src/WageholdSplitter.sol";
import {MockUSDC} from "../test/mocks/MockUSDC.sol";

/// @title Deploy
/// @notice Deploys `WageholdStrongbox` then `WageholdSplitter` to whichever network `--rpc-url`
/// points at.
///
/// Testnet / local (key in .env, roles default to the deployer):
///   forge script script/Deploy.s.sol --rpc-url robinhood_testnet --broadcast
///
/// Mainnet (Robinhood Chain, id 4663) -- keystore or Ledger, no private key on disk:
///   forge script script/Deploy.s.sol --rpc-url robinhood_mainnet \
///     --account wagehold-deployer --sender 0xALAMAT_DEPLOYER --broadcast
///   (leave DEPLOYER_PRIVATE_KEY unset)
///
/// Mainnet guards: WAGE_TOKEN_ADDRESS must be a deployed contract (never MockUSDC), and
/// COUNCIL_ADDRESS / OWNER_ADDRESS / LAMP_OIL_TREASURY_ADDRESS / TITHE_TREASURY_ADDRESS must all
/// be set explicitly, with owner != council. The script reverts during simulation otherwise.
contract Deploy is Script {
    uint256 internal constant MAINNET_CHAIN_ID = 4663;

    struct Roles {
        address council;
        address owner;
        address lampOilTreasury;
        address titheTreasury;
    }

    function run()
        external
        returns (WageholdStrongbox strongbox, WageholdSplitter splitter, address wageToken)
    {
        // Optional: unset => --account / --ledger on the command line sign instead.
        uint256 deployerKey = vm.envOr("DEPLOYER_PRIVATE_KEY", uint256(0));
        address deployer = deployerKey != 0 ? vm.addr(deployerKey) : msg.sender;

        wageToken = vm.envOr("WAGE_TOKEN_ADDRESS", address(0));
        Roles memory r = _roles(deployer);

        if (block.chainid == MAINNET_CHAIN_ID) {
            require(wageToken != address(0), "mainnet: WAGE_TOKEN_ADDRESS is required");
            require(wageToken.code.length > 0, "mainnet: WAGE_TOKEN_ADDRESS has no code");
            require(r.owner != r.council, "mainnet: owner and council must differ");
        }

        if (deployerKey != 0) {
            vm.startBroadcast(deployerKey);
        } else {
            vm.startBroadcast();
        }

        if (wageToken == address(0)) {
            console2.log("WAGE_TOKEN_ADDRESS not set -- deploying MockUSDC for this run");
            wageToken = address(new MockUSDC());
        }

        strongbox = new WageholdStrongbox(IERC20(wageToken), r.council, r.owner);
        splitter = new WageholdSplitter(
            IERC20(wageToken), strongbox, r.council, r.owner, r.lampOilTreasury, r.titheTreasury
        );

        vm.stopBroadcast();

        console2.log("--- Wagehold deploy ---");
        console2.log("chainId:          ", block.chainid);
        console2.log("deployer:         ", deployer);
        console2.log("wageToken:        ", wageToken);
        console2.log("WageholdStrongbox:", address(strongbox));
        console2.log("WageholdSplitter: ", address(splitter));
        console2.log("council:          ", r.council);
        console2.log("owner:            ", r.owner);
        console2.log("lampOilTreasury:  ", r.lampOilTreasury);
        console2.log("titheTreasury:    ", r.titheTreasury);
    }

    /// @dev Testnet/local: every role defaults to the deployer. Mainnet: every role must be
    /// given explicitly (`envAddress` reverts when the variable is missing).
    function _roles(address deployer) internal view returns (Roles memory r) {
        if (block.chainid == MAINNET_CHAIN_ID) {
            r.council = vm.envAddress("COUNCIL_ADDRESS");
            r.owner = vm.envAddress("OWNER_ADDRESS");
            r.lampOilTreasury = vm.envAddress("LAMP_OIL_TREASURY_ADDRESS");
            r.titheTreasury = vm.envAddress("TITHE_TREASURY_ADDRESS");
        } else {
            r.council = vm.envOr("COUNCIL_ADDRESS", deployer);
            r.owner = vm.envOr("OWNER_ADDRESS", deployer);
            r.lampOilTreasury = vm.envOr("LAMP_OIL_TREASURY_ADDRESS", deployer);
            r.titheTreasury = vm.envOr("TITHE_TREASURY_ADDRESS", deployer);
        }
    }
}
