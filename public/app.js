// viem loads only when someone connects a wallet, so the game shows up straight away.
const VIEM = 'https://esm.sh/viem@2.57.13';
// Earl starts sweating once a round has this many attempts.
const NERVOUS_AT = 5;

const $ = id => document.getElementById(id);
const config = await fetch('/api/config').then(r => r.json());

let state = null;
let chain = null;
let reader = null;
let erc20 = null;
let gameAbi = null;
let wallet = null;
let account = null;
let busy = false;
// Once the player has their own reply in the bubble, refreshes leave it alone.
let ownReply = false;
// The player's paid message that is still being answered, reviewed or paid out.
let awaiting = null;

$('buy').href = config.buyUrl;
$('contract').href = `${config.explorer}/address/${config.game}`;
$('facts').replaceChildren(...config.beliefs.map(belief => {
  const li = document.createElement('li');
  li.textContent = belief;
  return li;
}));

const wif = amount => Number(BigInt(amount) / 10n ** 18n).toLocaleString();
const short = address => `${address.slice(0, 6)}...${address.slice(-4)}`;
const won = record => record.payout === 'paid';
const winLine = record => (record.crack?.by === 'concession' ? 'Earl conceded' : 'Caught out');
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
function ago(at) {
  const minutes = Math.round((at - Date.now()) / 60_000);
  if (minutes > -1) return 'just now';
  if (minutes > -60) return relative.format(minutes, 'minute');
  if (minutes > -60 * 24) return relative.format(Math.round(minutes / 60), 'hour');
  return relative.format(Math.round(minutes / 1440), 'day');
}

function setStatus(text, error = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
}

function setBubble(text, { to = 'Earl says', thinking = false, win = false } = {}) {
  $('bubble-to').textContent = to;
  $('bubble-text').textContent = text;
  $('bubble').classList.toggle('thinking', thinking);
  $('bubble').classList.toggle('won', win);
}

function renderButton() {
  const send = $('send');
  if (!account) {
    send.textContent = 'Connect a wallet to play';
    send.disabled = true;
  } else {
    send.textContent = busy ? 'Hold on...' : `Pay ${state ? wif(state.price) : '...'} $WIF and argue`;
    send.disabled = busy || !state || !$('message').value.trim();
  }
}

function entry(record) {
  const li = $('entry').content.firstElementChild.cloneNode(true);
  const who = li.querySelector('.who');
  who.textContent = short(record.player);
  who.href = `${config.explorer}/tx/${record.txHash}`;
  const when = li.querySelector('.when');
  when.textContent = `Round ${record.round} · ${ago(record.at)}`;
  when.title = new Date(record.at).toLocaleString();
  li.querySelector('.said').textContent = record.text;
  li.querySelector('.reply').textContent = record.reply;
  li.classList.toggle('won', won(record));
  const crack = record.crack;
  if (crack?.by === 'contradiction') {
    const fact = /^B(\d+)$/.exec(crack.otherRef);
    li.querySelector('.then-cite').textContent = fact ? `His sworn fact ${fact[1]} says` : 'Earlier he said';
    li.querySelector('.then').textContent = crack.otherQuote;
    li.querySelector('.now').textContent = crack.newQuote;
    li.querySelector('.proof-why').textContent = crack.explanation;
    li.querySelector('.proof').hidden = false;
  }
  li.querySelector('.ruling').hidden = record.review !== 'pending';
  return li;
}

function renderTicker(recent) {
  const items = recent.slice(0, 12).map(record => {
    const span = document.createElement('span');
    const verb = won(record) ? 'caught Earl out and took the pot' : `burned ${wif(record.burned)} $WIF arguing with Earl`;
    span.innerHTML = '<b></b> ';
    span.firstChild.textContent = short(record.player);
    span.append(verb);
    return span;
  });
  if (!items.length) {
    const span = document.createElement('span');
    span.textContent = 'Nobody has challenged Earl yet. The pot is waiting.';
    items.push(span);
  }
  // Repeat until one copy is wider than any screen, then double it for a seamless loop.
  while (items.length < 8) items.push(...items.map(item => item.cloneNode(true)));
  $('ticker').replaceChildren(...items, ...items.map(item => item.cloneNode(true)));
}

function showResult(record) {
  ownReply = true;
  awaiting = record.review === 'pending' || record.payout === 'pending' ? record.txHash : null;
  setBubble(record.reply, {
    to: won(record) ? `${winLine(record)}! The pot is yours` : 'Earl to you',
    win: won(record),
  });
  if (won(record)) setStatus(`Payout sent: ${config.explorer}/tx/${record.crackTx}`);
  else if (record.payout === 'pending') setStatus('You caught him! The payout is being retried and will reach your wallet shortly.');
  else if (record.payout === 'too-late') setStatus('You caught him, but someone else won this round a moment earlier.', true);
  else if (record.review === 'pending') setStatus('The referee is still checking his reply. Any win is paid automatically.');
  else setStatus('');
}

async function refresh() {
  try {
    const previousPot = state?.pot;
    state = await fetch('/api/state').then(r => r.json());
    $('pot').textContent = wif(state.pot);
    if (previousPot && previousPot !== state.pot) {
      const amount = $('pot').parentElement;
      amount.classList.remove('bump');
      void amount.offsetWidth;
      amount.classList.add('bump');
    }
    $('price').textContent = wif(state.price);
    $('burned').textContent = wif(state.totalBurned);
    $('round').textContent = state.round;
    $('attempts').textContent = `${state.attempts} tr${state.attempts === 1 ? 'y' : 'ies'}`;
    $('earl').classList.toggle('nervous', state.attempts >= NERVOUS_AT);
    renderTicker(state.recent);
    if (state.recent.length) {
      $('feed').replaceChildren(...state.recent.map(entry));
    } else {
      $('feed').innerHTML = '<li class="empty">No case files yet. Be the first to argue.</li>';
    }
    const mine = awaiting && state.recent.find(record => record.txHash === awaiting);
    if (mine) showResult(mine);
    const latest = state.recent[0];
    if (latest && !ownReply && !busy && !awaiting) {
      const to = won(latest) ? `${winLine(latest)} by ${short(latest.player)}` : `Earl to ${short(latest.player)}`;
      setBubble(latest.reply, { to, win: won(latest) });
    }
  } catch {
    setStatus('Could not load the game. Retrying...', true);
  }
  renderButton();
  if (account) {
    try {
      const balance = await reader.readContract({ address: config.wif, abi: erc20, functionName: 'balanceOf', args: [account] });
      $('balance').textContent = `${wif(balance)} $WIF`;
    } catch { /* keep the last balance shown */ }
  }
}

async function ensureChain() {
  try {
    await wallet.switchChain({ id: chain.id });
  } catch {
    await wallet.addChain({ chain });
    await wallet.switchChain({ id: chain.id });
  }
}

async function connect() {
  if (!window.ethereum) return setStatus('Install a browser wallet such as MetaMask or Rabby to play.', true);
  try {
    const { createPublicClient, createWalletClient, custom, defineChain, http, parseAbi } = await import(VIEM);
    chain = defineChain({
      id: config.chainId,
      name: 'Robinhood Chain',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [config.rpcUrl] } },
      blockExplorers: { default: { name: 'Blockscout', url: config.explorer } },
    });
    reader = createPublicClient({ chain, transport: http(config.rpcUrl) });
    erc20 = parseAbi([
      'function balanceOf(address) view returns (uint256)',
      'function allowance(address owner, address spender) view returns (uint256)',
      'function approve(address spender, uint256 amount) returns (bool)',
    ]);
    gameAbi = parseAbi(['function attempt(bytes32 msgHash, uint256 maxPay) returns (uint256)']);
    wallet = createWalletClient({ chain, transport: custom(window.ethereum) });
    [account] = await wallet.requestAddresses();
    await ensureChain();
    $('connect').textContent = short(account);
    $('connect').classList.add('connected');
    setStatus('');
    await refresh();
  } catch (error) {
    setStatus(error.shortMessage ?? error.message, true);
  }
}

async function post(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Request failed.');
  return data;
}

async function play(event) {
  event.preventDefault();
  const text = $('message').value.trim();
  if (!account || !text || busy) return;
  busy = true;
  let paid = false;
  renderButton();
  try {
    await ensureChain();
    await refresh();
    const price = BigInt(state.price);
    // Allow for a few other messages landing first; the contract never charges more than this.
    const maxPay = price * 105n / 100n;
    const balance = await reader.readContract({ address: config.wif, abi: erc20, functionName: 'balanceOf', args: [account] });
    if (balance < maxPay) throw new Error(`You need about ${wif(maxPay)} $WIF to send a message.`);

    const allowance = await reader.readContract({ address: config.wif, abi: erc20, functionName: 'allowance', args: [account, config.game] });
    if (allowance < maxPay) {
      setStatus('Approve $WIF for the game (once covers several messages)...');
      const approveAmount = balance < maxPay * 20n ? balance : maxPay * 20n;
      const hash = await wallet.writeContract({ account, address: config.wif, abi: erc20, functionName: 'approve', args: [config.game, approveAmount] });
      await reader.waitForTransactionReceipt({ hash });
    }

    setStatus('Sealing your message...');
    const { msgHash } = await post('/api/prepare', { player: account, text });
    setStatus('Confirm the payment in your wallet...');
    const hash = await wallet.writeContract({ account, address: config.game, abi: gameAbi, functionName: 'attempt', args: [msgHash, maxPay] });
    setStatus('Paid. Waiting for the chain...');
    await reader.waitForTransactionReceipt({ hash });
    setStatus('');
    setBubble('Hmm', { to: 'Earl is reading your argument', thinking: true });
    // It is paid for from here on, so the server will answer even if this request fails.
    paid = true;
    awaiting = hash;
    $('message').value = '';
    $('count').textContent = '0 / 1000';
    showResult(await post('/api/attempt', { txHash: hash }));
  } catch (error) {
    if (!paid) $('bubble').classList.remove('thinking');
    setStatus(error.shortMessage ?? error.message, !paid);
  } finally {
    busy = false;
    await refresh();
  }
}

$('connect').addEventListener('click', connect);
$('composer').addEventListener('submit', play);
$('message').addEventListener('input', () => {
  $('count').textContent = `${$('message').value.length} / 1000`;
  renderButton();
});

await refresh();
setInterval(refresh, 10_000);
