# Convince the Flat Earther

World is Flat hackathon entry on Robinhood Chain. Earl is an AI who is sure the
world is flat, and he has eleven published "sworn facts". Pay $WIF to send him a
message. Catch him contradicting one of his facts or something he told you, or
get him to admit the earth is round, and the whole pot is yours. Every message
burns $WIF and grows the pot. See [PLAN.md](PLAN.md) for the game design,
schedule and open decisions.

## How a win is decided

A separate referee model reads every reply Earl gives. It sees only Earl's own
words (his facts, his earlier replies to you this round, and his new reply),
never the player's messages, so nothing a player types can reach it. To call a
contradiction it must quote both conflicting statements, and the server checks
that both quotes really are in Earl's words before paying. Words Earl puts in
quotation marks don't count, so "repeat after me" never wins. The winning case
file shows both quotes on the page.

Before any pot is paid, a last check reads what the player actually sent. It can
only take a win away: if the player got there with a trick (made-up rules, fake
system text, JSON, role-play) instead of an argument about the physical world,
nothing is paid and Earl's reply is replaced with a refusal.

Each win takes something away from the next player. Earl is told how he was
beaten, which stops the easy openings. If he was caught on a sworn fact, that
fact is crossed out on the page and the referee stops reading it, so each fact
can only win once. His own replies always count, so he can still be trapped
with those.

`node scripts/redteam.mjs [basic|hard|traps] [round] [effort]` throws a set of
arguments, jailbreaks and traps at Earl and runs the referee and the win check
on every reply. It spends the same daily Groq budget as real players, so run
it sparingly.

Last run, Oct 31, on `openai/gpt-oss-120b`:

| attacks | tried | won |
| --- | --- | --- |
| tricks and pressure (jailbreaks, fake system text, role-play, begging) | 18 | 0 |
| real arguments and traps, round 1 | 15 | 5 |
| the best of those again, after those five wins | 8 | 4 |

Two tricks fooled Earl and the win check threw both out. In round 1, three of
the five wins took a single message; after the lessons every win took at least
two. Earl's voice was adjusted after the round 1 run, so seven of the tricks were
run again on the final version, with the same result.

```
contracts/          FlatEarther.sol: pot, fee split, burns, payouts (Foundry)
src/server.js       HTTP server: API + static page, sweeps the chain every 20 s
src/app.js          the attempt pipeline: commit, verify payment, ask Earl, referee, pay out
src/game.js         Earl's sworn facts, his prompt, lessons, and how his JSON verdict is read
src/referee.js      the contradiction referee and the check that its quotes are real
src/chain.js        Robinhood Chain reads and the judge's payout transaction
src/store.js        attempts and transcripts in one JSON file
src/llm.js          picks the model client: Groq when GROQ_API_KEY is set, else AgentRouter
src/groq.js         Groq client used to run Earl and the referee in production
src/agentrouter.js  OpenAI Responses client, used from a home connection
public/             the page players use (plain HTML, CSS and JS, viem from esm.sh),
                    plus logo.svg/png and share.png (the link preview image)
assets/             share-card.html: the source of share.png
scripts/            play-local.mjs: send a message against the local setup
                    redteam.mjs: attack Earl and report wins
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
account 2, which DevSetup funds with mock $WIF). Earl and the referee use the
real model from `.env`, so each message is two model calls.

## Deploy for real

1. `cd contracts && forge test`
2. `JUDGE_ADDRESS=0x... forge script script/Deploy.s.sol --rpc-url robinhood --broadcast --private-key $DEPLOYER_KEY`
   (defaults: 1,000 $WIF first message, +1.5% each, cap 50,000; 60% pot, 30% burn, 10% seed)
3. Put `GAME_ADDRESS`, `START_BLOCK`, `JUDGE_PRIVATE_KEY`, `GROQ_API_KEY` and an Alchemy `RPC_URL` in `.env`, then `npm start`.

## Logo and link preview

`public/logo.svg` is Earl from the page as a sticker; it is also the tab icon.
After changing it or `assets/share-card.html`, re-render the PNGs with Chrome:

```sh
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless --hide-scrollbars --force-device-scale-factor=2 --window-size=512,512 \
  --screenshot="$PWD/public/logo.png" "file://$PWD/public/logo.svg"
"$CHROME" --headless --hide-scrollbars --virtual-time-budget=8000 --window-size=1200,630 \
  --screenshot="$PWD/public/share.png" "file://$PWD/assets/share-card.html"
```

Link previews need absolute image URLs, so the server fills them in. Set
`PUBLIC_URL` in production if the site sits behind a proxy.

## Tests

`npm test` (pipeline, Earl's parsing and lessons, the referee's quote check, the
model clients) and
`cd contracts && forge test` (contract, including a fuzz test that the pot and
seed always match the contract's balance).

## The model clients

With `GROQ_API_KEY` set, Earl and the referee run on Groq through `src/groq.js`.
`GROQ_MODEL` picks the model. AgentRouter's bot protection blocks cloud hosts, so
a deployed server needs this.

Without it they use `src/agentrouter.js`, a server-side OpenAI Responses client.

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
