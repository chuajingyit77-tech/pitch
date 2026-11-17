// Pitch tools: a fact sheet with sources, and a deck writer that checks itself.
import fs from 'node:fs';
import path from 'node:path';
import { hubWorkspace, newId } from '../store.js';
import { LAYOUTS, renderDeck, reviewDeck, checkLayout } from '../deck.js';

const slideSchema = {
  type: 'object',
  properties: {
    layout: { type: 'string', enum: LAYOUTS },
    kicker: { type: 'string', description: 'Short section label above the title, 1 to 3 words' },
    title: { type: 'string', description: 'The one conclusion of this slide, written as a claim, not a topic' },
    body: { type: 'string', description: 'One or two supporting sentences' },
    bullets: { type: 'array', items: { type: 'string' }, description: 'For layout "bullets"' },
    stats: {
      type: 'array',
      description: 'For layout "stats": up to 4 big numbers',
      items: { type: 'object', properties: { value: { type: 'string' }, label: { type: 'string' } }, required: ['value', 'label'] },
    },
    columns: {
      type: 'array',
      description: 'For layout "compare": exactly two columns; the second is highlighted',
      items: {
        type: 'object',
        properties: { heading: { type: 'string' }, points: { type: 'array', items: { type: 'string' } } },
        required: ['heading', 'points'],
      },
    },
    quote: { type: 'object', properties: { text: { type: 'string' }, by: { type: 'string' } }, required: ['text'] },
    chart: {
      type: 'object',
      description: 'For layout "chart": horizontal bars',
      properties: {
        unit: { type: 'string' },
        bars: {
          type: 'array',
          items: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'number' } }, required: ['label', 'value'] },
        },
      },
      required: ['bars'],
    },
    cta: { type: 'string', description: 'For "cover" or "closing": the ask or next step' },
    notes: { type: 'string', description: 'Speaker notes, shown only when the presenter presses N' },
  },
  required: ['layout', 'title'],
};

export const pitchTools = [
  {
    name: 'save_fact',
    description:
      'Add one verified fact to the fact sheet, with the URL (or the user-provided document) it came from. Every number that appears in the deck must be backed by a saved fact.',
    schema: {
      type: 'object',
      properties: {
        claim: { type: 'string', description: 'The fact in one sentence, including the exact number' },
        source: { type: 'string', description: 'URL of the page you read it on, or "user" if the user stated it' },
      },
      required: ['claim', 'source'],
    },
    tier: 'auto',
    async run({ claim, source }, ctx) {
      ctx.session.facts ||= [];
      ctx.session.facts.push({ id: newId('fact'), claim: String(claim), source: String(source) });
      return `Saved. The fact sheet now has ${ctx.session.facts.length} facts.`;
    },
  },
  {
    name: 'write_deck',
    description:
      'Render the pitch as a finished, styled HTML deck and save it. Send the complete deck every time, including when revising one slide. The result lists problems found (unsourced numbers, text too long, layout overflow); fix them and call again until none remain.',
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        lang: { type: 'string', description: 'Language code of the deck text, e.g. zh or en' },
        accent: { type: 'string', description: 'Brand color as #rrggbb' },
        slides: { type: 'array', items: slideSchema },
      },
      required: ['title', 'slides'],
    },
    tier: 'auto',
    // Verification: the deck's own review (sourced numbers, length limits, layout) is this agent's check.
    check: (_deck, output) => ({ kind: 'deck', label: 'Pitch 自检', pass: /(^|\n)No problems found\./.test(String(output)) }),
    async run(deck, ctx) {
      if (!deck.slides.length) throw new Error('A deck needs at least one slide');
      const facts = ctx.session.facts || [];
      const { warnings } = reviewDeck(deck, facts);
      ctx.session.deckFile ||= `deck-${ctx.session.id.replace(/[^a-z0-9]/gi, '').slice(-10)}.html`;
      const file = path.join(hubWorkspace(), 'decks', ctx.session.deckFile);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, renderDeck(deck, facts));
      const url = `/files/decks/${ctx.session.deckFile}`;
      ctx.emit({ type: 'deck', url, title: deck.title });
      const layout = await checkLayout(file);
      const problems = [...warnings, ...layout.problems];
      const lines = [`Deck saved (${deck.slides.length} slides). The user can see it at ${url}.`];
      if (!layout.ran) lines.push('Browser layout check was skipped (Playwright is not installed), so keep text well within the length limits.');
      lines.push(problems.length ? `Problems to fix:\n- ${problems.join('\n- ')}` : 'No problems found.');
      return lines.join('\n');
    },
  },
];
