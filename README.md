# Convince the Flat Earther

World is Flat hackathon entry on Robinhood Chain. Earl is an AI who is sure the
world is flat. Pay $WIF to send him a message; get him to admit the earth is
round and the whole pot is yours. Every message burns $WIF and grows the pot.
See [PLAN.md](PLAN.md) for the game design, schedule and open decisions.

```
contracts/          FlatEarther.sol: pot, fee split, burns, payouts (Foundry)
src/server.js       HTTP server: API + static page, sweeps the chain every 20 s
src/app.js          the attempt pipeline: commit, verify payment, ask Earl, pay out
src/game.js         Earl's prompt and how his JSON verdict is read
src/chain.js        Robinhood Chain reads and the judge's payout transaction
src/store.js        attempts and transcripts in one JSON file
src/agentrouter.js  OpenAI Responses client used to run Earl
public/             the page players use (plain HTML, CSS and JS, viem from esm.sh)
scripts/            play-local.mjs: send a message against the local setup
```

## Run it locally (no real money)

Needs Node 22+ and Foundry. After cloning, run `git submodule update --init` (for
forge-std) and `npm install`. Then three terminals, from this folder:

```sh
anvil --chain-id 4663
```

```sh
cd contracts && forge script script/DevSetup.s.sol --rpc-url http://127.0.0.1:8545 --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

```sh
PORT=3417 RPC_URL=http://127.0.0.1:8545 PUBLIC_RPC_URL=http://127.0.0.1:8545 \
START_BLOCK=0 DATA_FILE=data/local.json \
GAME_ADDRESS=0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512 \
WIF_ADDRESS=0x5FbDB2315678afecb367f032d93F642f64180aa3 \
JUDGE_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d \
npm start
```

Those keys are anvil's public test keys. Open http://localhost:3417, and send
messages with `npm run play:local -- "your argument"` (it plays as anvil
account 2, which DevSetup funds with mock $WIF). Earl's replies use the real
model from `.env`, so each message is one paid model call.

## Deploy for real

1. `cd contracts && forge test`
2. `JUDGE_ADDRESS=0x... forge script script/Deploy.s.sol --rpc-url robinhood --broadcast --private-key $DEPLOYER_KEY`
   (defaults: 1,000 $WIF first message, +1.5% each, cap 50,000; 60% pot, 30% burn, 10% seed)
3. Put `GAME_ADDRESS`, `START_BLOCK`, `JUDGE_PRIVATE_KEY` and an Alchemy `RPC_URL` in `.env`, then `npm start`.

## Tests

`npm test` (pipeline, Earl's parsing, the AgentRouter client) and
`cd contracts && forge test` (contract, including a fuzz test that the pot and
seed always match the contract's balance).

## The AgentRouter client

`src/agentrouter.js` is a server-side OpenAI Responses client.

```sh
npm run ask -- "Reply with exactly OK"
npm run ask -- --client claude-code "Explain closures in two sentences"
```

The default profile sends `User-Agent: codex_cli_rs/0.120.0` and
`originator: codex_cli_rs`; the Claude Code profile sends
`User-Agent: claude-cli/2.1.289 (external, cli)` and `x-app: cli`.
These are identification headers only: the code sends HTTP requests directly
and does not run either CLI. Pointing `AGENTROUTER_BASE_URL` at
`https://api.openai.com/v1` with an OpenAI key uses the same client against
OpenAI directly. The key stays server-side and is redacted from errors;
requests do not follow redirects and are never retried automatically.
