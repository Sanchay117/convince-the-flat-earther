import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

/** Game records in one JSON file. Small enough for a hackathon, and easy to publish. */
export class Store {
  #file;
  #data;

  constructor(file) {
    this.#file = file;
    try {
      this.#data = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.#data = { pending: {}, attempts: {}, lastBlock: null };
    }
  }

  get lastBlock() { return this.#data.lastBlock; }
  set lastBlock(block) { this.#data.lastBlock = block; this.#save(); }

  addPending(msgHash, { player, text }) {
    const now = Date.now();
    for (const [hash, item] of Object.entries(this.#data.pending)) {
      if (now - item.at > PENDING_TTL_MS) delete this.#data.pending[hash];
    }
    this.#data.pending[msgHash] = { player, text, at: now };
    this.#save();
  }

  pending(msgHash) { return this.#data.pending[msgHash]; }

  attempt(msgHash) { return this.#data.attempts[msgHash]; }

  saveAttempt(record) {
    this.#data.attempts[record.msgHash] = record;
    delete this.#data.pending[record.msgHash];
    this.#save();
  }

  /** Newest first. */
  attempts({ round, player, limit = Infinity } = {}) {
    return Object.values(this.#data.attempts)
      .filter(a => (round === undefined || a.round === round) && (!player || a.player === player))
      .sort((a, b) => b.at - a.at)
      .slice(0, limit);
  }

  #save() {
    mkdirSync(dirname(this.#file), { recursive: true });
    const tmp = `${this.#file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.#data, null, 2));
    renameSync(tmp, this.#file);
  }
}
