// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {FlatEarther, IERC20} from "../src/FlatEarther.sol";

/// forge script script/Deploy.s.sol --rpc-url robinhood --broadcast --private-key $DEPLOYER_KEY
contract Deploy is Script {
    function run() external returns (FlatEarther game) {
        address wif = vm.envOr("WIF_ADDRESS", address(0x5173b8eA6923c2d40267890D45C46a3480954773));
        address judge = vm.envAddress("JUDGE_ADDRESS");
        uint256 basePrice = vm.envOr("BASE_PRICE", uint256(1_000e18));
        uint256 maxPrice = vm.envOr("MAX_PRICE", uint256(50_000e18));
        uint256 growthBps = vm.envOr("GROWTH_BPS", uint256(150));
        uint256 potBps = vm.envOr("POT_BPS", uint256(6_000));
        uint256 burnBps = vm.envOr("BURN_BPS", uint256(3_000));

        vm.startBroadcast();
        game = new FlatEarther(IERC20(wif), judge, basePrice, maxPrice, growthBps, potBps, burnBps);
        vm.stopBroadcast();
        console.log("FlatEarther deployed at", address(game));
    }
}
