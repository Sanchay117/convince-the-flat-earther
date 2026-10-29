// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {FlatEarther, IERC20} from "../src/FlatEarther.sol";
import {MockWIF} from "./MockWIF.sol";

contract FlatEartherTest is Test {
    MockWIF wif;
    FlatEarther game;
    address judge = makeAddr("judge");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address dead = 0x000000000000000000000000000000000000dEaD;

    uint256 constant BASE = 1_000e18;
    uint256 constant MAX = 50_000e18;

    function setUp() public {
        wif = new MockWIF();
        // 1.5% growth, 60% pot, 30% burn, 10% seed
        game = new FlatEarther(IERC20(address(wif)), judge, BASE, MAX, 150, 6_000, 3_000);
        for (uint256 i; i < 2; i++) {
            address p = i == 0 ? alice : bob;
            wif.mint(p, 10_000_000e18);
            vm.prank(p);
            wif.approve(address(game), type(uint256).max);
        }
    }

    function test_attemptSplitsFeeAndRaisesPrice() public {
        vm.prank(alice);
        uint256 paid = game.attempt(keccak256("hi"), BASE);

        assertEq(paid, BASE);
        assertEq(game.pot(), 600e18);
        assertEq(game.seed(), 100e18);
        assertEq(game.totalBurned(), 300e18);
        assertEq(wif.balanceOf(dead), 300e18);
        assertEq(wif.balanceOf(address(game)), 700e18);
        assertEq(game.price(), 1_015e18);
        assertEq(game.attempts(), 1);
        (address player, uint64 round) = game.attemptOf(keccak256("hi"));
        assertEq(player, alice);
        assertEq(round, 1);
    }

    function test_priceStopsAtCap() public {
        // 1.5% growth reaches 50x the base price after ~263 messages
        for (uint256 i; i < 300; i++) {
            vm.prank(alice);
            game.attempt(bytes32(i + 1), MAX);
        }
        assertEq(game.price(), MAX);
    }

    function test_attemptRevertsWhenPriceMovedAboveMaxPay() public {
        vm.prank(alice);
        game.attempt(keccak256("a"), BASE);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(FlatEarther.PriceMoved.selector, 1_015e18));
        game.attempt(keccak256("b"), BASE);
    }

    function test_hashCannotBeReused() public {
        vm.prank(alice);
        game.attempt(keccak256("a"), BASE);
        vm.prank(bob);
        vm.expectRevert(FlatEarther.HashUsed.selector);
        game.attempt(keccak256("a"), type(uint256).max);
    }

    function test_crackPaysWinnerAndStartsNextRoundFromSeed() public {
        vm.prank(alice);
        game.attempt(keccak256("a"), BASE);
        vm.prank(bob);
        game.attempt(keccak256("b"), type(uint256).max);
        uint256 pot = game.pot();
        uint256 seed = game.seed();
        uint256 before = wif.balanceOf(bob);

        vm.prank(judge);
        game.crack(bob, keccak256("b"));

        assertEq(wif.balanceOf(bob), before + pot);
        assertEq(game.round(), 2);
        assertEq(game.pot(), seed);
        assertEq(game.seed(), 0);
        assertEq(game.price(), BASE);
        assertEq(game.attempts(), 0);
        assertEq(wif.balanceOf(address(game)), seed);
    }

    function test_crackOnlyByJudge() public {
        vm.prank(alice);
        game.attempt(keccak256("a"), BASE);
        vm.prank(alice);
        vm.expectRevert(FlatEarther.NotAuthorized.selector);
        game.crack(alice, keccak256("a"));
    }

    function test_crackRejectsWrongPlayerUnknownHashAndOldRound() public {
        vm.prank(alice);
        game.attempt(keccak256("a"), BASE);

        vm.startPrank(judge);
        vm.expectRevert(FlatEarther.NotThisRound.selector);
        game.crack(bob, keccak256("a"));
        vm.expectRevert(FlatEarther.NotThisRound.selector);
        game.crack(alice, keccak256("never paid"));
        vm.expectRevert(FlatEarther.NotThisRound.selector);
        game.crack(address(0), keccak256("never paid"));

        game.crack(alice, keccak256("a"));
        vm.expectRevert(FlatEarther.NotThisRound.selector);
        game.crack(alice, keccak256("a"));
        vm.stopPrank();
    }

    function test_fundAddsToPot() public {
        vm.prank(bob);
        game.fund(5_000e18);
        assertEq(game.pot(), 5_000e18);
        assertEq(wif.balanceOf(address(game)), 5_000e18);
    }

    function test_ownerRotatesJudge() public {
        address newJudge = makeAddr("newJudge");
        vm.prank(alice);
        vm.expectRevert(FlatEarther.NotAuthorized.selector);
        game.setJudge(newJudge);

        game.setJudge(newJudge);
        assertEq(game.judge(), newJudge);
    }

    function test_constructorRejectsBadConfig() public {
        vm.expectRevert(FlatEarther.BadConfig.selector);
        new FlatEarther(IERC20(address(wif)), judge, BASE, MAX, 150, 8_000, 3_000);
        vm.expectRevert(FlatEarther.BadConfig.selector);
        new FlatEarther(IERC20(address(wif)), judge, MAX, BASE, 150, 6_000, 3_000);
        vm.expectRevert(FlatEarther.ZeroAddress.selector);
        new FlatEarther(IERC20(address(wif)), address(0), BASE, MAX, 150, 6_000, 3_000);
    }

    function testFuzz_splitAlwaysAddsUp(uint256 n) public {
        n = bound(n, 1, 60);
        for (uint256 i; i < n; i++) {
            vm.prank(i % 2 == 0 ? alice : bob);
            game.attempt(bytes32(i + 1), type(uint256).max);
        }
        assertEq(wif.balanceOf(address(game)), game.pot() + game.seed());
        assertEq(wif.balanceOf(dead), game.totalBurned());
    }
}
