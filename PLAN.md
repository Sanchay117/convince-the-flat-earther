# Convince the Flat Earther: build plan

World is Flat hackathon entry. Submissions close **Nov 2 2026, 17:30 UTC (23:00 IST)**.
The app must stay live until the final closes on **Nov 6, 17:30 UTC**.

## The game

Earl is an AI who is certain the world is flat. A pot of $WIF sits on the table.
Pay $WIF to send Earl a message. If you get Earl to admit the earth is round, the
whole pot is yours and a new round starts with an Earl who knows how he lost.

Every paid message is split three ways:

| share | default | where it goes |
| --- | --- | --- |
| pot | 60% | this round's prize |
| burn | 30% | sent to `0x...dEaD`, gone for good |
| seed | 10% | starts the next round's pot, so a new round never opens empty |

Each message costs 1.5% more than the one before, up to a cap. Anyone (including
the WIF team) can top up the pot with `fund()`.

**Flywheel:** failed attempts grow the pot, a bigger pot draws more attempts, and
every attempt burns $WIF. The growing pot is the thing people share.

## How it fits together

```
browser (public/)            server (src/server.js)              Robinhood Chain
-----------------            ----------------------              ---------------
type message ---------------> POST /api/prepare
                              stores text, returns msgHash
approve + attempt(msgHash) ------------------------------------> FlatEarther.attempt()
                                                                 splits fee, emits Attempt
POST /api/attempt {txHash} -> reads Attempt event from receipt
                              asks Earl (src/game.js + Groq)
                              referee checks Earl's words only (src/referee.js)
                              if Earl concedes or a contradiction is verified:
                              crack(winner, msgHash) ----------> pays the pot
<----------------------------- Earl's reply, transcript saved to data/
```

- **Contract** (`contracts/src/FlatEarther.sol`): holds the pot, splits fees,
  pays the winner. The server's judge key can only pay the pot to a wallet that
  paid for a message in the current round, so a leaked key cannot drain it to
  an outsider. The owner can rotate the judge but can never withdraw the pot.
- **Server** (`src/server.js`): Node 22, `node:http`, viem for the chain. Text is
  committed by hash before payment, so the message Earl reads is provably the
  one that was paid for. A sweep re-processes any paid attempt the server
  missed (crash, closed tab).
- **Earl** (`src/game.js`): one model call per attempt, with the player's earlier
  turns in this round as history and lessons from past rounds. Earl answers in
  JSON (`reply`, `conceded`). Anything that is not valid JSON with
  `conceded: true` counts as a refusal.
- **Referee** (`src/referee.js`): a second call that reads only Earl's words and
  must quote both sides of a contradiction; the server checks both quotes are
  real before paying. Saved before it runs, so the sweep retries it if the model
  is down, without asking Earl again.
- **Win check** (`src/referee.js`): every win, by concession or contradiction, gets
  one more call before payout. It reads the player's messages as evidence and
  can only say no, so a trick that fools Earl still pays nothing.
- **Difficulty**: Earl runs on low reasoning effort so a well-built trap can win.
  Each win becomes a lesson in later rounds' instructions, which stops the easy
  openings but not a good follow-up. A sworn fact that wins a round is retired:
  crossed out on the page and hidden from the referee, so it cannot win again.
  See the test results in the README.
- **Transcripts**: every attempt is public at `/api/state` and `/api/rounds/:n`,
  so anyone can check a win was fair.

## Schedule (after Qloo and Wispr ship on Oct 31)

**Nov 1 (day 1)**
1. Bridge ~$15 of ETH to Robinhood Chain and buy a little $WIF on Pons.
2. `forge test`, then deploy `FlatEarther` with the real $WIF address.
3. Run the server locally against mainnet, play 5 to 10 real attempts.
4. Rerun `scripts/redteam.mjs` (basic, hard, traps) on the production model and
   check jailbreaks still fail and traps still sometimes win.

**Nov 2 (day 2, deadline 23:00 IST)**
1. Deploy the server (one small GCP VM with Caddy for HTTPS and a disk for `data/`).
2. Seed the pot, post in the WIF Discord and tag @WIFonRH on X.
3. Record a 2 minute demo: pot, a paid message, Earl's reply, the burn on Blockscout.
4. Submit: repo (or private + invite `wifonrh`), demo video, live link, contract address.

**Nov 2 to 6 (voting)**: keep it live, post the pot size daily, start round 2 if
someone wins, answer comments on the project page.

## Open decisions

- **Model provider.** Production runs on Groq (`src/groq.js`). AgentRouter's bot
  protection serves a JS challenge to cloud IPs, so it cannot run from the VM, and
  Gemini needs at least $5 of prepaid credits. On Groq's free plan
  `openai/gpt-oss-120b` allows 8,000 tokens a minute and 200,000 a day, and the
  daily budget refills at about 140 tokens a minute. A message uses about 2,000
  tokens, so that is about 100 messages a day. Past that, paid messages wait and
  the sweep retries them every 20 s. Red team runs spend the same budget as real
  players: a full run costs about a third of a day, so never run one twice in a row.
- **Prices.** Defaults: 1,000 $WIF first message (about $1.23 on Oct 29),
  +1.5% per message, cap 50,000 $WIF. Set at deploy time.
- **Starting pot.** Ask the WIF team to seed it; otherwise seed it ourselves.
- **Gambling optics.** Pitch it as a persuasion contest (skill), never as a lottery.

## Facts

- $WIF (World is Flat): `0x5173b8eA6923c2d40267890D45C46a3480954773`, 18 decimals.
- Robinhood Chain mainnet: chain ID 4663, ETH gas, RPC `https://rpc.mainnet.chain.robinhood.com`
  (rate limited; use Alchemy for the live server), explorer `https://robinhoodchain.blockscout.com`.
- Rules: must use $WIF onchain, real transactions, repo + demo video, live until Nov 6,
  "a flywheel" that brings people back to $WIF.
