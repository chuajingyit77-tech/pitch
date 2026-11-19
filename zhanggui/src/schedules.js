// Scheduled tasks: a prompt an agent runs by itself at a set time of day.
import { readJson, writeJson, newId } from './store.js';

export const listSchedules = () => readJson('schedules.json', []);
const save = (all) => writeJson('schedules.json', all);

export function createSchedule({ name, agent, prompt, time, days }) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time))) throw new Error('时间格式应为 HH:MM');
  if (!String(prompt || '').trim()) throw new Error('任务内容不能为空');
  const item = {
    id: newId('sch'),
    name: String(name || '').trim().slice(0, 60) || String(prompt).trim().slice(0, 30),
    agent,
    prompt: String(prompt).trim(),
    time,
    days: days === 'weekdays' ? 'weekdays' : 'daily',
    enabled: true,
    createdAt: new Date().toISOString(),
    lastRunAt: null,
    lastSessionId: null,
    lastStatus: null,
  };
  save([...listSchedules(), item]);
  return item;
}

export function updateSchedule(id, patch) {
  const all = listSchedules();
  const item = all.find((s) => s.id === id);
  if (!item) return null;
  Object.assign(item, patch);
  save(all);
  return item;
}

export function deleteSchedule(id) {
  save(listSchedules().filter((s) => s.id !== id));
}

/**
 * Whether a task should run now: today's slot has passed and has not been used yet.
 * A slot missed while the program was closed still runs later the same day, but a slot
 * that had already passed when the task was created (or re-enabled) does not.
 */
export function isDue(s, now = new Date()) {
  if (!s.enabled) return false;
  const day = now.getDay();
  if (s.days === 'weekdays' && (day === 0 || day === 6)) return false;
  const [h, m] = s.time.split(':').map(Number);
  const slot = new Date(now);
  slot.setHours(h, m, 0, 0);
  if (slot > now) return false;
  const since = Math.max(Date.parse(s.lastRunAt || 0) || 0, Date.parse(s.enabledAt || s.createdAt) || 0);
  return slot.getTime() > since;
}
