// Sales tools. Agents can find leads and draft emails; only the user can approve one, and nothing is ever sent from here.
import { readJson, writeJson, newId } from '../store.js';

export const listLeads = () => readJson('leads.json', []);
export const saveLeads = (leads) => writeJson('leads.json', leads);
export const listSuppressed = () => readJson('suppression.json', []);

const cleanDomain = (d) =>
  String(d || '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');

export function isSuppressed(lead) {
  const blocked = listSuppressed();
  return blocked.includes(cleanDomain(lead.domain)) || (lead.email && blocked.includes(String(lead.email).toLowerCase()));
}

export function suppress(value) {
  const v = String(value).includes('@') ? String(value).toLowerCase().trim() : cleanDomain(value);
  if (!v) return;
  const all = new Set(listSuppressed());
  all.add(v);
  writeJson('suppression.json', [...all]);
}

export function updateLead(id, patch) {
  const leads = listLeads();
  const lead = leads.find((l) => l.id === id);
  if (!lead) return null;
  Object.assign(lead, patch);
  saveLeads(leads);
  return lead;
}

const DAY = 86_400_000;
// First follow-up three days after the email went out, the second four days after the first.
export const FOLLOWUP_GAP_DAYS = [3, 4];

/** When the next follow-up for a sent lead falls due, or null if none is owed. */
export function followupDueAt(lead) {
  if (lead.status !== 'sent') return null;
  const n = lead.followupsSent || 0;
  if (n >= FOLLOWUP_GAP_DAYS.length) return null;
  return Date.parse(lead.lastTouchAt || lead.sentAt) + FOLLOWUP_GAP_DAYS[n] * DAY;
}

export const followupIsDue = (lead, now = Date.now()) => {
  const at = followupDueAt(lead);
  return at !== null && now >= at;
};

/** How many things in the sales queue are waiting on the user right now. */
export function salesTodo(now = Date.now()) {
  return listLeads().filter((l) => l.status === 'pending' || followupIsDue(l, now)).length;
}

const isUrl = (s) => /^https?:\/\/\S+$/.test(String(s || ''));

export const salesTools = [
  {
    name: 'save_lead',
    description:
      'Record a prospect company that fits the ideal customer profile. Each reason must cite the public page it came from. Companies on the do-not-contact list are refused, and a company already saved is updated rather than duplicated.',
    schema: {
      type: 'object',
      properties: {
        company: { type: 'string' },
        domain: { type: 'string', description: 'Company website domain, e.g. acme.com' },
        contact_name: { type: 'string', description: 'Named contact, only if publicly listed in a business capacity' },
        contact_role: { type: 'string' },
        email: { type: 'string', description: 'Only a publicly listed business address; never guess one' },
        score: { type: 'integer', description: 'Fit from 0 to 100' },
        reasons: {
          type: 'array',
          description: 'Up to three reasons this company fits, each with its source',
          items: {
            type: 'object',
            properties: { text: { type: 'string' }, source: { type: 'string', description: 'URL where this is stated' } },
            required: ['text', 'source'],
          },
        },
      },
      required: ['company', 'domain', 'score', 'reasons'],
    },
    tier: 'auto',
    async run(input) {
      const domain = cleanDomain(input.domain);
      if (!domain.includes('.')) throw new Error('domain must be a website domain such as acme.com');
      const bad = (input.reasons || []).filter((r) => !isUrl(r.source));
      if (!input.reasons?.length || bad.length) throw new Error('Every reason needs a source URL starting with http(s)://');
      const lead = {
        company: String(input.company),
        domain,
        contactName: input.contact_name || '',
        contactRole: input.contact_role || '',
        email: input.email || '',
        score: Math.max(0, Math.min(100, Number(input.score) || 0)),
        reasons: input.reasons.slice(0, 3).map((r) => ({ text: String(r.text), source: String(r.source) })),
      };
      if (isSuppressed(lead)) return `${domain} is on the do-not-contact list. Not saved; do not contact them.`;
      const leads = listLeads();
      const existing = leads.find((l) => l.domain === domain);
      if (existing) {
        Object.assign(existing, lead);
        saveLeads(leads);
        return `Updated existing lead ${existing.id} (${lead.company}).`;
      }
      const created = { id: newId('lead'), ...lead, status: 'new', draft: null, createdAt: new Date().toISOString() };
      leads.push(created);
      saveLeads(leads);
      return `Saved lead ${created.id} (${lead.company}, score ${lead.score}).`;
    },
  },
  {
    name: 'draft_email',
    description:
      'Write the first outreach email for a saved lead, plus two short follow-ups, and put them in the approval queue. Nothing is sent: the user reviews, edits and sends it themselves. Open with something true and sourced about the company, keep it short, and end with one clear next step and a line offering to stop further emails.',
    schema: {
      type: 'object',
      properties: {
        lead_id: { type: 'string' },
        subject: { type: 'string' },
        body: { type: 'string' },
        followups: { type: 'array', items: { type: 'string' }, description: 'Two shorter follow-up emails, for about day 3 and day 7 if there is no reply' },
      },
      required: ['lead_id', 'subject', 'body'],
    },
    tier: 'auto',
    async run({ lead_id, subject, body, followups = [] }) {
      const lead = listLeads().find((l) => l.id === lead_id);
      if (!lead) throw new Error(`No lead with id ${lead_id}. Use list_leads to see ids.`);
      if (isSuppressed(lead)) return `${lead.domain} is on the do-not-contact list. No draft was created.`;
      if (['sent', 'replied'].includes(lead.status)) return `The first email to ${lead.company} has already gone out. Use draft_followup for a follow-up instead.`;
      updateLead(lead_id, {
        status: 'pending',
        draft: { subject: String(subject), body: String(body), followups: followups.slice(0, 2).map(String) },
      });
      return `Draft queued for the user's approval (${lead.company}). It will not be sent until they approve and send it.`;
    },
  },
  {
    name: 'draft_followup',
    description:
      'Write or replace the next follow-up email for a lead whose first email the user has already sent and who has not replied. It appears in the queue when the follow-up falls due; the user sends it. Keep it shorter than the first email, add something new rather than repeating it, and stop offering once two follow-ups have gone out.',
    schema: {
      type: 'object',
      properties: { lead_id: { type: 'string' }, body: { type: 'string' } },
      required: ['lead_id', 'body'],
    },
    tier: 'auto',
    async run({ lead_id, body }) {
      const lead = listLeads().find((l) => l.id === lead_id);
      if (!lead) throw new Error(`No lead with id ${lead_id}. Use list_leads to see ids.`);
      if (isSuppressed(lead)) return `${lead.domain} is on the do-not-contact list. No follow-up was created.`;
      if (lead.status === 'replied') return `${lead.company} has replied, so automatic follow-ups have stopped. The user handles the conversation from here.`;
      if (lead.status !== 'sent') return `The first email to ${lead.company} has not been sent yet (status: ${lead.status}). Follow-ups come after it.`;
      const n = lead.followupsSent || 0;
      if (n >= FOLLOWUP_GAP_DAYS.length) return `Both follow-ups to ${lead.company} have already gone out. Do not chase further.`;
      const followups = [...(lead.draft?.followups || [])];
      followups[n] = String(body);
      updateLead(lead_id, { draft: { ...lead.draft, followups } });
      return `Follow-up ${n + 1} saved for ${lead.company}. The user will see it when it falls due.`;
    },
  },
  {
    name: 'list_leads',
    description:
      'List saved leads with their id, score and status (new, pending approval, approved, sent, replied, rejected), whether a follow-up is due, and the reason the user gave for any they rejected.',
    schema: { type: 'object', properties: {} },
    tier: 'auto',
    async run() {
      const leads = listLeads();
      if (!leads.length) return 'No leads saved yet.';
      return leads
        .map((l) => {
          const due = followupIsDue(l) ? ` | follow-up ${(l.followupsSent || 0) + 1} due${l.draft?.followups?.[l.followupsSent || 0] ? '' : ' (not drafted yet)'}` : '';
          return `${l.id} | ${l.company} (${l.domain}) | score ${l.score} | ${l.status}${due}${l.rejectReason ? ` | rejected: ${l.rejectReason}` : ''}`;
        })
        .join('\n');
    },
  },
];
