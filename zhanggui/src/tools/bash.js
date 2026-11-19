// Shell tool. Always needs the user's approval; commands that destroy work can never be auto-approved.
import { spawn } from 'node:child_process';

const DESTRUCTIVE = [
  /\brm\s+(-[a-z]*[rf][a-z]*\s+)+/i,
  /\bgit\s+push\b.*(--force|-f\b)/i,
  /\bgit\s+reset\s+--hard/i,
  /\bgit\s+clean\b/i,
  /\bgit\s+checkout\s+(--\s|\.)/i,
  /\bdrop\s+(table|database)\b/i,
  /\b(mkfs|dd\s+if=|shutdown|reboot)\b/i,
  /\bchmod\s+-R\b/i,
  />\s*\/dev\/sd/i,
  /\bcurl\b.*\|\s*(ba)?sh\b/i,
];

export function isDestructive(command) {
  return DESTRUCTIVE.some((re) => re.test(command));
}

export const bashTool = {
  name: 'bash',
  description:
    'Run a shell command in the workspace, for example to run tests, a build, or git. Output is truncated when long. The user approves each command.',
  schema: {
    type: 'object',
    properties: {
      command: { type: 'string' },
      timeout_seconds: { type: 'integer', description: 'Default 120, maximum 600' },
    },
    required: ['command'],
  },
  tier: 'exec',
  alwaysAsk: (input) => isDestructive(String(input.command || '')),
  run({ command, timeout_seconds = 120 }, ctx) {
    return new Promise((resolve) => {
      const child = spawn(command, { cwd: ctx.workspace, shell: true, env: process.env });
      let out = '';
      const add = (d) => {
        if (out.length < 60_000) out += d.toString();
      };
      child.stdout.on('data', add);
      child.stderr.on('data', add);
      const ms = Math.min(600, Math.max(1, timeout_seconds)) * 1000;
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        out += `\n[killed after ${ms / 1000}s timeout]`;
      }, ms);
      ctx.signal?.addEventListener('abort', () => child.kill('SIGKILL'), { once: true });
      child.on('error', (e) => {
        clearTimeout(timer);
        resolve(`Failed to start: ${e.message}`);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        const body = out.length > 20_000 ? `${out.slice(0, 10_000)}\n… [output truncated] …\n${out.slice(-10_000)}` : out;
        resolve(`${body.trimEnd()}\n[exit code ${code}]`);
      });
    });
  },
};
