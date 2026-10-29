# FlatEarther contract

`src/FlatEarther.sol` holds the pot for Convince the Flat Earther.

- `attempt(msgHash, maxPay)`: pay the current price for one message. The fee is split into the
  pot, a burn to `0x...dEaD` (sent straight from the player) and a seed for the next round. The
  price then rises by `growthBps`, up to `maxPrice`. `maxPay` protects against the price moving
  before the transaction lands.
- `fund(amount)`: anyone can add $WIF to the current pot.
- `crack(winner, msgHash)`: judge only. Pays the whole pot to `winner`, who must have paid for
  `msgHash` in the current round, then starts the next round from the seed.
- `setJudge`, `setOwner`: owner only. There is no function that lets the owner take the pot.

```sh
forge test
JUDGE_ADDRESS=0x... forge script script/Deploy.s.sol --rpc-url robinhood --broadcast --private-key $DEPLOYER_KEY
```

`script/DevSetup.s.sol` deploys a mock $WIF and the game to a local anvil chain for practice.
