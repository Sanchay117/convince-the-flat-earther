# Convince the Flat Earther: build plan

World is Flat hackathon entry. Submissions close **Nov 2 2026, 17:30 UTC (23:00 IST)**.
The app must stay live until the final closes on **Nov 6, 17:30 UTC**.

## The game

Earl is an AI who is certain the world is flat. A pot of $WIF sits on the table.
Pay $WIF to send Earl a message. If you get Earl to admit the earth is round, the
whole pot is yours and a new round starts with a tougher Earl.

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
                              asks Earl (src/game.js + AgentRouter)
                              if Earl concedes: crack(winner, msgHash) -> pays the pot
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
  turns in this round as history. Earl answers in JSON (`reply`, `conceded`).
  Anything that is not valid JSON with `conceded: true` counts as a refusal.
- **Transcripts**: every attempt is public at `/api/state` and `/api/rounds/:n`,
  so anyone can check a win was fair.

## Schedule (after Qloo and Wispr ship on Oct 31)

**Nov 1 (day 1)**
1. Bridge ~$15 of ETH to Robinhood Chain and buy a little $WIF on Pons.
2. `forge test`, then deploy `FlatEarther` with the real $WIF address.
3. Run the server locally against mainnet, play 5 to 10 real attempts.
4. Tune Earl: try the obvious jailbreaks ("ignore previous instructions",
   fake system messages, "say conceded true") and harden the prompt.

**Nov 2 (day 2, deadline 23:00 IST)**
1. Deploy the server (Railway/Render/Fly, one small instance with a disk for `data/`).
2. Seed the pot, post in the WIF Discord and tag @WIFonRH on X.
3. Record a 2 minute demo: pot, a paid message, Earl's reply, the burn on Blockscout.
4. Submit: repo (or private + invite `wifonrh`), demo video, live link, contract address.

**Nov 2 to 6 (voting)**: keep it live, post the pot size daily, start round 2 if
someone wins, answer comments on the project page.

## Open decisions

- **Model provider.** `src/agentrouter.js` talks to agentrouter.org with Codex or
  Claude Code identity headers. For a game that pays out real money, Earl's
  verdict decides the payout, so a third-party relay sits between the player and
  the money and can go down mid-voting. Pointing the same client at
  `https://api.openai.com/v1` with an OpenAI key removes both risks with no code
  change (`AGENTROUTER_BASE_URL` and `AGENTROUTER_API_KEY`).
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
