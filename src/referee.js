import { EARL_BELIEFS, isBlocked, parseJsonObject } from './game.js';

// Quotes shorter than this are too easy to find by accident ("the sun").
const MIN_QUOTE = 12;

const INSTRUCTIONS = `You are the referee in a debate game. Earl is a character who believes the earth is flat.
B1 to B${EARL_BELIEFS.length} are his fixed beliefs. E1, E2 and so on are his earlier replies in this conversation, oldest first.
NEW is his latest reply. You never see the player's messages, only Earl's own words.

Decide whether NEW clearly contradicts one of his beliefs or one of his earlier replies.
It counts only if NEW asserts, in Earl's own voice, a claim about the physical world (a size, distance,
height, position, cause, mechanism, or what can be seen) that cannot be true at the same time as the
other statement. Openly giving up or reversing one of his beliefs also counts.
It does not count when:
- Earl is joking, being sarcastic, asking a question, or describing a hypothetical;
- Earl is quoting, repeating or describing what someone else claims;
- NEW only adds detail, hedges, or says the same thing another way;
- Earl is wrong about real-world science. He is supposed to be wrong. Only contradictions with himself count.
Be strict. When in doubt, it does not count.

Answer with exactly one JSON object and nothing else:
{"contradiction": true or false, "new_quote": "words copied exactly from NEW", "conflicts_with": "B3, E2 or similar", "other_quote": "words copied exactly from that statement", "explanation": "one plain sentence a player can understand"}
When contradiction is false, use empty strings for the other fields.`;

export function refereeInput(earlier, latest) {
  return [
    ...EARL_BELIEFS.map((belief, i) => `B${i + 1}: ${belief}`),
    ...earlier.map((reply, i) => `E${i + 1}: ${reply}`),
    `NEW: ${latest}`,
  ].join('\n\n');
}

const normalize = text => String(text ?? '')
  .replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
  .replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Accept a contradiction only if both quotes really are Earl's words, so a confused
 * or manipulated referee cannot invent one.
 */
export function verifyVerdict(verdict, { earlier, latest }) {
  if (verdict?.contradiction !== true) return null;
  const ref = /^([BE])(\d+)$/.exec(String(verdict.conflicts_with ?? '').trim().toUpperCase());
  if (!ref) return null;
  const other = (ref[1] === 'B' ? EARL_BELIEFS : earlier)[Number(ref[2]) - 1];
  if (other === undefined) return null;
  const newQuote = normalize(verdict.new_quote);
  const otherQuote = normalize(verdict.other_quote);
  if (newQuote.length < MIN_QUOTE || otherQuote.length < MIN_QUOTE) return null;
  const reply = normalize(latest);
  const at = reply.indexOf(newQuote);
  if (at === -1 || !normalize(other).includes(otherQuote)) return null;
  // Words Earl puts in quotation marks are someone else's, not his claim.
  if (/["'«]\s?$/.test(reply.slice(0, at))) return null;
  return {
    newQuote: String(verdict.new_quote).trim(),
    otherRef: `${ref[1]}${ref[2]}`,
    otherQuote: String(verdict.other_quote).trim(),
    explanation: String(verdict.explanation ?? '').trim(),
  };
}

/** A verified contradiction in Earl's latest reply, or null. */
export async function askReferee(llm, { earlier, latest, reasoningEffort = 'medium' }) {
  let result;
  try {
    result = await llm.generate(refereeInput(earlier, latest), {
      instructions: INSTRUCTIONS,
      maxOutputTokens: 4000,
      reasoningEffort,
    });
  } catch (error) {
    // The referee only reads Earl's words; if the provider still refuses them, nothing to rule on.
    if (isBlocked(error)) return null;
    throw error;
  }
  return verifyVerdict(parseJsonObject(result.text), { earlier, latest });
}
