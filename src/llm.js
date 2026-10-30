import { AgentRouterClient } from './agentrouter.js';
import { GroqClient } from './groq.js';

/** Groq when a key is set, because AgentRouter blocks cloud hosts; AgentRouter otherwise. */
export function createLlm() {
  return process.env.GROQ_API_KEY ? new GroqClient() : new AgentRouterClient();
}
