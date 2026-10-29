import { AgentRouterClient } from './agentrouter.js';

try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: npm run ask -- [--client codex|claude-code] [--json] "Your prompt"
       printf 'Your prompt' | npm run ask --

Uses .env, gpt-6.1-sol, and Codex identification headers by default.
Set AGENTROUTER_CLIENT=claude-code for Claude Code identification headers.`);
} else {
  try {
    let client;
    let json = false;
    const words = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--client') {
        client = args[++i];
        if (!client || client.startsWith('--')) throw new Error('--client needs codex or claude-code.');
      } else if (args[i] === '--json') json = true;
      else if (args[i].startsWith('--')) throw new Error(`Unknown option: ${args[i]}`);
      else words.push(args[i]);
    }
    let prompt = words.join(' ');
    if (!words.length && !process.stdin.isTTY) {
      process.stdin.setEncoding('utf8');
      for await (const chunk of process.stdin) prompt += chunk;
    }
    if (!prompt.trim()) throw new Error('Provide a prompt. See npm run ask -- --help.');
    const router = new AgentRouterClient({ client });
    const result = await router.generate(prompt, {
      onText: json ? undefined : delta => process.stdout.write(delta),
    });
    if (json) console.log(JSON.stringify(result, null, 2));
    else process.stdout.write('\n');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
