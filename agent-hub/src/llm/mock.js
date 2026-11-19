// Scripted provider for tests and for trying the interface without a key (AGENT_HUB_MOCK=1).
// A script is a list of turns; each turn is { text, toolCalls } or a function of the messages so far.
let script = null;
let n = 0; // one counter for all instances, so tool ids stay unique across agents running together

export function setMockScript(turns) {
  script = turns ? [...turns] : null;
}

// Canned turns for demo mode, so every part of the interface can be tried without a key.
const DEMO = {
  pitch: [
    { text: '（演示）先记录几条事实。', toolCalls: [
      { name: 'save_fact', input: { claim: '月活用户 12,000', source: 'user' } },
      { name: 'save_fact', input: { claim: '客服成本降低 40%', source: 'https://example.com/case-study' } },
      { name: 'save_fact', input: { claim: '本轮计划融资 300 万美元', source: 'user' } },
    ] },
    { toolCalls: [{ name: 'write_deck', input: { title: '演示 Pitch', lang: 'zh', slides: [
      { layout: 'cover', kicker: 'Seed 轮', title: '让每个小团队都有一支 AI 客服', body: '演示数据，用于展示版式。', cta: '融资 300 万美元' },
      { layout: 'statement', kicker: '问题', title: '中小商家的客服，又贵又慢', body: '人工客服排班难、培训久，夜间和大促时响应最差。' },
      { layout: 'stats', kicker: '进展', title: '上线一年，数据说明需求真实', stats: [{ value: '12,000', label: '月活用户' }, { value: '40%', label: '客服成本下降' }, { value: '95%', label: '续费率（未提供来源）' }] },
      { layout: 'compare', kicker: '方案', title: '从“加人”变成“加一个 agent”', columns: [{ heading: '传统做法', points: ['招聘与培训周期长', '夜间无人值守', '成本随咨询量线性增长'] }, { heading: '我们的做法', points: ['当天接入', '全天候响应', '成本基本固定'] }] },
      { layout: 'chart', kicker: '市场', title: '首次响应时间对比', chart: { unit: ' 分钟', bars: [{ label: '我们', value: 1 }, { label: '行业平均', value: 9 }] } },
      { layout: 'closing', title: '一起把客服变成增长引擎', cta: 'hello@example.com' },
    ] } }] },
    { text: '（演示）Pitch 已生成，见右侧预览。其中“95% 续费率”没有来源，已在页面上标为待确认。' },
  ],
  sales: [
    { text: '（演示）保存一条线索并起草邮件。', toolCalls: [{ name: 'save_lead', input: { company: '示例电商', domain: 'example.com', contact_role: '运营负责人', score: 82, reasons: [{ text: '正在招聘客服主管，说明客服压力在增加', source: 'https://example.com/careers' }] } }] },
    (messages) => {
      const saved = /lead_\w+/.exec(messages.at(-1).results[0].content);
      return { toolCalls: [{ name: 'draft_email', input: { lead_id: saved ? saved[0] : 'lead_x', subject: '关于贵司客服团队扩张', body: '您好，\n\n看到贵司正在招聘客服主管。我们帮助类似规模的电商把首次响应时间降到一分钟以内。\n\n方便下周用 15 分钟聊聊吗？\n\n如不希望再收到此类邮件，回复“退订”即可。' } }] };
    },
    { text: '（演示）线索和邮件草稿已放进右侧的审批队列，等你批准。这里不会自动发送邮件。' },
  ],
  coding: [
    { text: '（演示）先看一下目录。', toolCalls: [{ name: 'bash', input: { command: 'ls' } }] },
    { text: '（演示）命令已处理。填入真实的 API key 后，我会真正阅读和修改代码。' },
  ],
  relay: [
    { text: '（演示）分两棒：销售先找线索，Pitch 再据此做方案。', toolCalls: [{ name: 'run_relay', input: { legs: [{ agent: 'sales', task: '找一家潜在客户并起草邮件' }, { agent: 'pitch', task: '为这家客户做一份 pitch' }] } }] },
    { text: '（演示）接力完成：销售找到 1 条线索并起草了邮件（等你批准），Pitch 据此生成了方案，见右侧预览。' },
  ],
  quartet: [
    { text: '（演示）三个 agent 同时开工。', toolCalls: [{ name: 'run_quartet', input: { parts: [{ agent: 'pitch', task: '做一份 pitch' }, { agent: 'sales', task: '找一家潜在客户' }, { agent: 'assistant', task: '写一份备忘' }] } }] },
    { text: '（演示）四重奏完成：pitch 已生成，线索和邮件草稿在审批队列里，备忘已写入工作区。' },
  ],
  assistant: [
    { text: '（演示）我写一个文件试试。', toolCalls: [{ name: 'write_file', input: { path: 'demo.txt', content: 'hello from demo mode\n' } }] },
    { text: '（演示）文件已写入工作区。这是演示模式：填入真实的 API key 后，这里会是真实模型的回答。' },
  ],
};

function demoTurn(messages, system) {
  const agent = /You are the (\w+)(?: agent|:)/.exec(system || '')?.[1] || 'assistant';
  const flow = DEMO[agent] || DEMO.assistant;
  // Position in the flow = model turns since the last user message.
  let turns = 0;
  for (let i = messages.length - 1; i >= 0 && messages[i].role !== 'user'; i--) if (messages[i].role === 'assistant') turns++;
  const turn = flow[Math.min(turns, flow.length - 1)];
  return typeof turn === 'function' ? turn(messages) : turn;
}

export function createMockProvider() {
  return {
    id: 'mock',
    model: 'mock',
    async complete({ messages, system, onText }) {
      let turn = script ? script.shift() : demoTurn(messages, system);
      if (typeof turn === 'function') turn = await turn(messages);
      if (!turn) turn = { text: '(mock script exhausted)' };
      if (turn.text) onText?.(turn.text);
      const toolCalls = (turn.toolCalls || []).map((c) => ({ id: c.id || `mock_${++n}`, name: c.name, input: c.input || {} }));
      return {
        text: turn.text || '',
        toolCalls,
        stopReason: turn.stopReason || (toolCalls.length ? 'tool_use' : 'end_turn'),
        usage: { input: 0, output: 0 },
        raw: null,
      };
    },
    async listModels() {
      return ['mock'];
    },
  };
}
