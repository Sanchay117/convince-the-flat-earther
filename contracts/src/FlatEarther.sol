// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title Convince the Flat Earther
/// @notice Pay $WIF to send Earl a message. Each fee is split into this round's pot,
/// a burn and a seed for the next round. If Earl concedes the earth is round, the
/// judge (the game server) pays the pot to the player whose message did it.
/// @dev The judge can only pay a player who paid for that exact message in the
/// current round, and the owner has no way to withdraw the pot.
contract FlatEarther {
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 private constant BPS = 10_000;

    IERC20 public immutable wif;
    uint256 public immutable basePrice;
    uint256 public immutable maxPrice;
    uint256 public immutable growthBps;
    uint256 public immutable potBps;
    uint256 public immutable burnBps;

    address public owner;
    address public judge;

    uint256 public round = 1;
    uint256 public pot;
    uint256 public seed;
    uint256 public price;
    uint256 public attempts;
    uint256 public totalBurned;

    struct Attempt {
        address player;
        uint64 round;
    }

    /// @notice Who paid for each message hash, and in which round.
    mapping(bytes32 => Attempt) public attemptOf;

    event Attempted(
        uint256 indexed round, address indexed player, bytes32 indexed msgHash, uint256 paid, uint256 burned
    );
    event Funded(uint256 indexed round, address indexed from, uint256 amount);
    event Cracked(uint256 indexed round, address indexed winner, bytes32 indexed msgHash, uint256 prize);
    event JudgeChanged(address judge);
    event OwnerChanged(address owner);

    error ZeroAddress();
    error BadConfig();
    error NotAuthorized();
    error HashUsed();
    error PriceMoved(uint256 price);
    error NotThisRound();
    error TransferFailed();

    constructor(
        IERC20 wif_,
        address judge_,
        uint256 basePrice_,
        uint256 maxPrice_,
        uint256 growthBps_,
        uint256 potBps_,
        uint256 burnBps_
    ) {
        if (address(wif_) == address(0) || judge_ == address(0)) revert ZeroAddress();
        if (basePrice_ == 0 || maxPrice_ < basePrice_ || potBps_ + burnBps_ > BPS) revert BadConfig();
        wif = wif_;
        judge = judge_;
        owner = msg.sender;
        basePrice = basePrice_;
        maxPrice = maxPrice_;
        growthBps = growthBps_;
        potBps = potBps_;
        burnBps = burnBps_;
        price = basePrice_;
    }

    /// @notice Pay for one message. `msgHash` is the server's commitment to the text.
    /// @param maxPay Reverts if the price rose above this before the tx landed.
    function attempt(bytes32 msgHash, uint256 maxPay) external returns (uint256 paid) {
        if (attemptOf[msgHash].player != address(0)) revert HashUsed();
        paid = price;
        if (paid > maxPay) revert PriceMoved(paid);

        uint256 toPot = paid * potBps / BPS;
        uint256 toBurn = paid * burnBps / BPS;
        attemptOf[msgHash] = Attempt(msg.sender, uint64(round));
        pot += toPot;
        seed += paid - toPot - toBurn;
        totalBurned += toBurn;
        attempts++;
        uint256 next = paid * (BPS + growthBps) / BPS;
        price = next > maxPrice ? maxPrice : next;

        // The burn goes straight from the player to 0xdead, so the explorer shows who burned it.
        if (toBurn != 0) _transferFrom(msg.sender, DEAD, toBurn);
        _transferFrom(msg.sender, address(this), paid - toBurn);
        emit Attempted(round, msg.sender, msgHash, paid, toBurn);
    }

    /// @notice Add $WIF to the current pot. Anyone can do this.
    function fund(uint256 amount) external {
        pot += amount;
        _transferFrom(msg.sender, address(this), amount);
        emit Funded(round, msg.sender, amount);
    }

    /// @notice Pay the pot to the player whose message made Earl concede, then start a new round.
    function crack(address winner, bytes32 msgHash) external {
        if (msg.sender != judge) revert NotAuthorized();
        Attempt memory a = attemptOf[msgHash];
        if (winner == address(0) || a.player != winner || a.round != round) revert NotThisRound();

        uint256 prize = pot;
        emit Cracked(round, winner, msgHash, prize);
        round++;
        pot = seed;
        seed = 0;
        price = basePrice;
        attempts = 0;
        _transfer(winner, prize);
    }

    function setJudge(address judge_) external {
        if (msg.sender != owner) revert NotAuthorized();
        if (judge_ == address(0)) revert ZeroAddress();
        judge = judge_;
        emit JudgeChanged(judge_);
    }

    function setOwner(address owner_) external {
        if (msg.sender != owner) revert NotAuthorized();
        if (owner_ == address(0)) revert ZeroAddress();
        owner = owner_;
        emit OwnerChanged(owner_);
    }

    function _transfer(address to, uint256 amount) private {
        _call(abi.encodeCall(IERC20.transfer, (to, amount)));
    }

    function _transferFrom(address from, address to, uint256 amount) private {
        _call(abi.encodeCall(IERC20.transferFrom, (from, to, amount)));
    }

    // Accepts tokens that return nothing as well as ones that return true.
    function _call(bytes memory data) private {
        (bool ok, bytes memory ret) = address(wif).call(data);
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }
}
