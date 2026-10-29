import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentRouterClient } from './agentrouter.js';
import { createGame, UserError } from './app.js';
import { createChain, EXPLORER, PUBLIC_RPC, WIF_ADDRESS, robinhood } from './chain.js';
import { EARL_BELIEFS } from './game.js';
import { Store } from './store.js';

const root = fileURLToPath(new URL('..', import.meta.url));
try {
  process.loadEnvFile(join(root, '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const env = process.env;
const store = new Store(resolve(root, env.DATA_FILE || 'data/game.json'));
if (store.lastBlock == null && env.START_BLOCK) store.lastBlock = Number(env.START_BLOCK) - 1;
const chain = createChain({ rpcUrl: env.RPC_URL || PUBLIC_RPC, address: env.GAME_ADDRESS, judgeKey: env.JUDGE_PRIVATE_KEY });
const game = createGame({
  llm: new AgentRouterClient(), chain, store,
  reasoningEffort: env.EARL_EFFORT || 'low',
  refereeEffort: env.REFEREE_EFFORT || 'medium',
});

// Sent to the browser. Never put the Alchemy URL here: it carries the API key.
const publicConfig = {
  chainId: robinhood.id,
  rpcUrl: env.PUBLIC_RPC_URL || PUBLIC_RPC,
  explorer: EXPLORER,
  game: chain.address,
  wif: env.WIF_ADDRESS || WIF_ADDRESS,
  buyUrl: env.BUY_WIF_URL || 'https://worldisflat.fun',
  beliefs: EARL_BELIEFS,
};

const publicDir = join(root, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 16_384) throw new UserError('Request too large.', 413);
  }
  try {
    return JSON.parse(body || '{}');
  } catch {
    throw new UserError('Invalid JSON.');
  }
}

async function serveStatic(res, pathname) {
  const file = resolve(publicDir, `.${pathname === '/' ? '/index.html' : decodeURIComponent(pathname)}`);
  if (!file.startsWith(publicDir + sep)) return send(res, 404, { error: 'Not found' });
  try {
    send(res, 200, await readFile(file), TYPES[extname(file)] ?? 'application/octet-stream');
  } catch {
    send(res, 404, { error: 'Not found' });
  }
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && pathname === '/api/config') return send(res, 200, publicConfig);
    if (req.method === 'GET' && pathname === '/api/state') return send(res, 200, await game.state());
    const roundMatch = /^\/api\/rounds\/(\d+)$/.exec(pathname);
    if (req.method === 'GET' && roundMatch) return send(res, 200, game.round(Number(roundMatch[1])));
    if (req.method === 'POST' && pathname === '/api/prepare') return send(res, 200, game.prepare(await readJson(req)));
    if (req.method === 'POST' && pathname === '/api/attempt') {
      const { txHash } = await readJson(req);
      return send(res, 200, await game.submit(txHash));
    }
    if (req.method === 'GET' && !pathname.startsWith('/api/')) return serveStatic(res, pathname);
    send(res, 404, { error: 'Not found' });
  } catch (error) {
    if (error instanceof UserError) return send(res, error.status, { error: error.message });
    console.error(error);
    send(res, 500, { error: 'Something went wrong.' });
  }
});

const port = Number(env.PORT || 3000);
server.listen(port, () => {
  console.log(`Convince the Flat Earther on http://localhost:${port}`);
  console.log(`game ${chain.address}, judge ${chain.judge}`);
});

let sweeping = false;
setInterval(async () => {
  if (sweeping) return;
  sweeping = true;
  try {
    await game.sweep();
  } catch (error) {
    console.error(`sweep failed: ${error.shortMessage ?? error.message}`);
  } finally {
    sweeping = false;
  }
}, 20_000);
