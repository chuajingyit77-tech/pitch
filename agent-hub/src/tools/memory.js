// Long-term memory: short facts and preferences that carry across conversations.
import { readJson, writeJson, newId } from '../store.js';

export function listMemories() {
  return readJson('memory.json', []);
}

export function deleteMemory(id) {
  writeJson('memory.json', listMemories().filter((m) => m.id !== id));
}

export const memoryTools = [
  {
    name: 'remember',
    description:
      'Save a lasting fact or preference about the user for future conversations, such as their company, role, tone, or standing instructions. Not for one-off task details.',
    schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    tier: 'auto',
    async run({ text }) {
      const all = listMemories();
      const item = { id: newId('mem'), text: String(text).slice(0, 500), at: new Date().toISOString() };
      all.push(item);
      writeJson('memory.json', all.slice(-200));
      return `Saved (${item.id})`;
    },
  },
  {
    name: 'forget',
    description: 'Delete a saved memory by its id when it is wrong or the user asks.',
    schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    tier: 'auto',
    async run({ id }) {
      deleteMemory(id);
      return 'Deleted';
    },
  },
];

export function memoryPrompt() {
  const all = listMemories();
  if (!all.length) return '';
  return `\n\nWhat you already know about the user (saved memories):\n${all.map((m) => `- [${m.id}] ${m.text}`).join('\n')}`;
}
