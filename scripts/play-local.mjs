// Play one message against the local anvil setup, the same way the browser does.
// node scripts/play-local.mjs "Earl, why do ships vanish hull first?"
import { createPublicClient, createWalletClient, http, maxUint256, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { robinhood } from '../src/chain.js';

const SERVER = process.env.SERVER_URL || 'http://localhost:3417';
const RPC = process.env.RPC_URL || 'http://127.0.0.1:8545';
// anvil default account 2, funded with mock $WIF by DevSetup.s.sol
const account = privateKeyToAccount(process.env.PLAYER_KEY
  || '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a');

const text = process.argv.slice(2).join(' ');
if (!text) throw new Error('Usage: node scripts/play-local.mjs "your message"');

const chain = { ...robinhood, rpcUrls: { default: { http: [RPC] } } };
const reader = createPublicClient({ chain, transport: http(RPC) });
const wallet = createWalletClient({ account, chain, transport: http(RPC) });
const config = await fetch(`${SERVER}/api/config`).then(r => r.json());
const state = await fetch(`${SERVER}/api/state`).then(r => r.json());

async function post(path, body) {
  const res = await fetch(`${SERVER}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data;
}

const erc20 = parseAbi(['function approve(address, uint256) returns (bool)']);
const game = parseAbi(['function attempt(bytes32 msgHash, uint256 maxPay) returns (uint256)']);
const approve = await wallet.writeContract({ address: config.wif, abi: erc20, functionName: 'approve', args: [config.game, maxUint256] });
await reader.waitForTransactionReceipt({ hash: approve });

const { msgHash } = await post('/api/prepare', { player: account.address, text });
const maxPay = BigInt(state.price) * 105n / 100n;
const hash = await wallet.writeContract({ address: config.game, abi: game, functionName: 'attempt', args: [msgHash, maxPay] });
await reader.waitForTransactionReceipt({ hash });
console.log(`paid ${hash}, asking Earl...`);
console.log(await post('/api/attempt', { txHash: hash }));
