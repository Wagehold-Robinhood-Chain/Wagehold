// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {WageholdStrongbox} from "../src/WageholdStrongbox.sol";
import {WageholdSplitter} from "../src/WageholdSplitter.sol";
import {MockUSDC} from "../test/mocks/MockUSDC.sol";

/// @title Deploy
/// @notice Fase 2 item 4 -- deploys `WageholdStrongbox` then `WageholdSplitter` (in that order,
/// since the Splitter's constructor needs the Strongbox's address) to whichever network
/// `--rpc-url` points at. Written to work unchanged on Robinhood Chain testnet/mainnet or any
/// other EVM chain -- it reads every address from the environment rather than hardcoding one.
///
/// Usage (see contracts/.env.example for what to fill in):
///   forge script script/Deploy.s.sol --rpc-url robinhood_testnet --broadcast --verify \
///     --verifier blockscout --verifier-url https://explorer.testnet.chain.robinhood.com/api
///
/// Dry run (no broadcast, just simulate and print addresses):
///   forge script script/Deploy.s.sol --rpc-url robinhood_testnet
contract Deploy is Script {
    function run()
        external
        returns (WageholdStrongbox strongbox, WageholdSplitter splitter, address wageToken)
    {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        // Council/owner/treasuries default to the deployer if not set, so a solo testnet run
        // needs nothing but DEPLOYER_PRIVATE_KEY -- fill in the real addresses in .env before
        // ever deploying to mainnet with real funds (Charter II: council is never an agent's
        // own address, and it should not stay the same EOA as the deployer in production).
        address council = vm.envOr("COUNCIL_ADDRESS", deployer);
        address owner = vm.envOr("OWNER_ADDRESS", deployer);
        address lampOilTreasury = vm.envOr("LAMP_OIL_TREASURY_ADDRESS", deployer);
        address titheTreasury = vm.envOr("TITHE_TREASURY_ADDRESS", deployer);

        // WAGE_TOKEN_ADDRESS lets this point at a real bridged USDC (or any ERC20) once one
        // exists on the target chain. Left unset, it deploys a fresh MockUSDC instead --
        // convenient for early testnet runs, but MockUSDC has an open `mint()` anyone can call
        // (see test/mocks/MockUSDC.sol), so it must never be used as the real wageToken on
        // mainnet.
        address wageTokenAddress = vm.envOr("WAGE_TOKEN_ADDRESS", address(0));

        vm.startBroadcast(deployerKey);

        if (wageTokenAddress == address(0)) {
            console2.log("WAGE_TOKEN_ADDRESS not set -- deploying MockUSDC for this run");
            wageTokenAddress = address(new MockUSDC());
        }

        strongbox = new WageholdStrongbox(IERC20(wageTokenAddress), council, owner);
        splitter = new WageholdSplitter(
            IERC20(wageTokenAddress), strongbox, council, owner, lampOilTreasury, titheTreasury
        );

        vm.stopBroadcast();

        wageToken = wageTokenAddress;

        console2.log("--- Wagehold deploy ---");
        console2.log("wageToken:        ", wageTokenAddress);
        console2.log("WageholdStrongbox:", address(strongbox));
        console2.log("WageholdSplitter: ", address(splitter));
        console2.log("council:          ", council);
        console2.log("owner:            ", owner);
        console2.log("lampOilTreasury:  ", lampOilTreasury);
        console2.log("titheTreasury:    ", titheTreasury);
    }
}
