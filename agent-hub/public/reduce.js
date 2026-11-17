// Folds the event stream of a run into the list of items shown in the chat.
// Used by the server (to save the transcript) and by the browser (to draw it live), so both always agree.
export function applyEvent(items, ev) {
  const lane = `${ev.agent || ''}:${ev.depth || 0}`;
  switch (ev.type) {
    case 'user':
      items.push({ type: 'user', text: ev.text });
      break;
    case 'start':
      items.push({ type: 'start', agent: ev.agent, depth: ev.depth || 0, provider: ev.provider, model: ev.model });
      break;
    case 'text': {
      let open = items.findLast((i) => i.type === 'text' && i.lane === lane && i.open);
      if (!open) {
        open = { type: 'text', lane, agent: ev.agent, depth: ev.depth || 0, text: '', open: true };
        items.push(open);
      }
      open.text += ev.delta;
      break;
    }
    case 'text_end': {
      const open = items.findLast((i) => i.type === 'text' && i.lane === lane && i.open);
      if (open) open.open = false;
      break;
    }
    case 'tool':
      items.push({ type: 'tool', id: ev.id, name: ev.name, input: ev.input, agent: ev.agent, depth: ev.depth || 0, server: ev.server, state: ev.server ? 'done' : 'running' });
      break;
    case 'tool_result': {
      const tool = items.findLast((i) => i.type === 'tool' && i.id === ev.id);
      if (tool) Object.assign(tool, { result: ev.content, isError: ev.isError, state: 'done' });
      break;
    }
    case 'approval':
      items.push({ type: 'approval', id: ev.id, tool: ev.tool, tier: ev.tier, input: ev.input, agent: ev.agent, state: 'pending' });
      break;
    case 'approval_done': {
      const a = items.findLast((i) => i.type === 'approval' && i.id === ev.id);
      if (a) a.state = ev.allow ? 'allowed' : 'denied';
      break;
    }
    case 'notice':
    case 'error':
      items.push({ type: ev.type, text: ev.text, depth: ev.depth || 0 });
      break;
    case 'deck':
      items.push({ type: 'deck', url: ev.url, title: ev.title });
      break;
    case 'done':
      if (!ev.depth) for (const i of items) if (i.open) i.open = false;
      break;
  }
  return items;
}
