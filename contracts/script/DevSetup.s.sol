// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {FlatEarther, IERC20} from "../src/FlatEarther.sol";
import {MockWIF} from "../test/MockWIF.sol";

/// Local practice setup on anvil: a mock $WIF, the game, and a seeded pot.
/// anvil --chain-id 4663
/// forge script script/DevSetup.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --private-key <anvil key 0>
contract DevSetup is Script {
    function run() external {
        // anvil's default accounts 1 and 2: the judge and a player
        address judge = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
        address player = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;

        vm.startBroadcast();
        MockWIF wif = new MockWIF();
        FlatEarther game = new FlatEarther(IERC20(address(wif)), judge, 1_000e18, 50_000e18, 150, 6_000, 3_000);
        wif.mint(msg.sender, 1_000_000e18);
        wif.mint(player, 1_000_000e18);
        wif.approve(address(game), 25_000e18);
        game.fund(25_000e18);
        vm.stopBroadcast();

        console.log("WIF_ADDRESS", address(wif));
        console.log("GAME_ADDRESS", address(game));
    }
}
