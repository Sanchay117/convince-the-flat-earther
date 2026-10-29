import { createPublicClient, createWalletClient, defineChain, http, parseAbi, parseEventLogs } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export const PUBLIC_RPC = 'https://rpc.mainnet.chain.robinhood.com';
export const EXPLORER = 'https://robinhoodchain.blockscout.com';
export const WIF_ADDRESS = '0x5173b8eA6923c2d40267890D45C46a3480954773';

export const robinhood = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [PUBLIC_RPC] } },
  blockExplorers: { default: { name: 'Blockscout', url: EXPLORER } },
});

export const gameAbi = parseAbi([
  'function round() view returns (uint256)',
  'function pot() view returns (uint256)',
  'function seed() view returns (uint256)',
  'function price() view returns (uint256)',
  'function attempts() view returns (uint256)',
  'function totalBurned() view returns (uint256)',
  'function attempt(bytes32 msgHash, uint256 maxPay) returns (uint256)',
  'function fund(uint256 amount)',
  'function crack(address winner, bytes32 msgHash)',
  'event Attempted(uint256 indexed round, address indexed player, bytes32 indexed msgHash, uint256 paid, uint256 burned)',
  'event Cracked(uint256 indexed round, address indexed winner, bytes32 indexed msgHash, uint256 prize)',
]);

// Keep each eth_getLogs request small enough for public RPC limits.
const LOG_CHUNK = 5_000n;

function toAttempt(log) {
  return {
    round: Number(log.args.round),
    player: log.args.player,
    msgHash: log.args.msgHash,
    paid: log.args.paid.toString(),
    burned: log.args.burned.toString(),
    txHash: log.transactionHash,
    block: Number(log.blockNumber),
  };
}

export function createChain({ rpcUrl = PUBLIC_RPC, address, judgeKey }) {
  if (!address) throw new Error('Set GAME_ADDRESS to the deployed FlatEarther contract.');
  if (!judgeKey) throw new Error('Set JUDGE_PRIVATE_KEY to the judge wallet key.');
  const transport = http(rpcUrl);
  const client = createPublicClient({ chain: robinhood, transport });
  const judge = createWalletClient({ account: privateKeyToAccount(judgeKey), chain: robinhood, transport });
  const read = functionName => client.readContract({ address, abi: gameAbi, functionName });
  const isGame = log => log.address.toLowerCase() === address.toLowerCase();

  return {
    address,
    judge: judge.account.address,

    async state() {
      const names = ['round', 'pot', 'seed', 'price', 'attempts', 'totalBurned'];
      const values = await Promise.all(names.map(read));
      const state = Object.fromEntries(names.map((name, i) => [name, values[i].toString()]));
      return { ...state, round: Number(state.round), attempts: Number(state.attempts) };
    },

    async currentRound() {
      return Number(await read('round'));
    },

    async attemptsInTx(txHash) {
      const receipt = await client.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 });
      if (receipt.status !== 'success') return [];
      return parseEventLogs({ abi: gameAbi, eventName: 'Attempted', logs: receipt.logs })
        .filter(isGame).map(toAttempt);
    },

    /** Attempts after `afterBlock`, read in chunks up to the latest block. */
    async attemptsSince(afterBlock) {
      const latest = await client.getBlockNumber();
      let from = afterBlock == null ? latest - LOG_CHUNK : BigInt(afterBlock) + 1n;
      const attempts = [];
      while (from <= latest) {
        const to = from + LOG_CHUNK - 1n < latest ? from + LOG_CHUNK - 1n : latest;
        const logs = await client.getContractEvents({
          address, abi: gameAbi, eventName: 'Attempted', fromBlock: from, toBlock: to,
        });
        attempts.push(...logs.map(toAttempt));
        from = to + 1n;
      }
      return { attempts, toBlock: Number(latest) };
    },

    /** The tx that paid out for `msgHash`, if there is one. */
    async findCrack(msgHash, fromBlock) {
      const latest = await client.getBlockNumber();
      for (let from = BigInt(fromBlock); from <= latest; from += LOG_CHUNK) {
        const to = from + LOG_CHUNK - 1n < latest ? from + LOG_CHUNK - 1n : latest;
        const [log] = await client.getContractEvents({
          address, abi: gameAbi, eventName: 'Cracked', args: { msgHash }, fromBlock: from, toBlock: to,
        });
        if (log) return log.transactionHash;
      }
      return null;
    },

    async crack(winner, msgHash) {
      const hash = await judge.writeContract({
        address, abi: gameAbi, functionName: 'crack', args: [winner, msgHash],
      });
      const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
      if (receipt.status !== 'success') throw new Error(`crack transaction reverted: ${hash}`);
      return hash;
    },
  };
}
