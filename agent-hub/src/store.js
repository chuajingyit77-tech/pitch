// JSON-file persistence. Everything the system remembers lives under one data directory.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export function dataDir() {
  const dir = process.env.AGENT_HUB_DATA || path.join(here, '..', 'data');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function dataPath(...parts) {
  const p = path.join(dataDir(), ...parts);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  return p;
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(dataPath(file), 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(file, value) {
  const p = dataPath(file);
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, p);
}

/** The hub's own sandbox for generated files (decks, notes, exports). */
export function hubWorkspace() {
  const dir = path.join(dataDir(), 'workspace');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
