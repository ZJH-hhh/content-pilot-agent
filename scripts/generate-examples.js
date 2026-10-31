import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Agent } from '../src/agent.js';
import { MockModel } from '../src/model.js';
import { Store } from '../src/store.js';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-examples-'));
fs.mkdirSync('examples', { recursive: true });
const now = Date.now();
const summaries = [];
const cases = [
  ['01-normal', { budget: 15 }],
  ['02-budget-replan', { budget: 10 }],
  ['03-missing-budget', { budget: undefined }],
  ['04-missing-deadline', { deadline: undefined }],
  ['05-tool-failure', { scenario: 'tool_failure' }],
  ['06-budget-infeasible', { budget: 5 }],
  ['07-partial-result', { scenario: 'partial' }],
  ['08-save-failure-resume', { scenario: 'save_failure' }],
  ['09-step-limit', { maxSteps: 3 }],
  ['10-deadline-replan', { budget: 15, deadline: new Date(now + 60 * 60000).toISOString() }],
  ['11-deadline-infeasible', { deadline: new Date(now + 30 * 60000).toISOString() }],
  ['12-idempotency', {}]
];
try {
  const agent = new Agent(new Store(directory), { model: new MockModel(), now: () => now });
  for (const [name, extra] of cases) {
    const input = { theme: '城市漫游 · 发现身边的美好', budget: 10, deadline: new Date(now + 86400000).toISOString(), requestKey: name, ...extra };
    const { task } = agent.create(input);
    await agent.run(task.id);
    const record = { disclosure: 'Actual execution of deterministic offline Mock, not real LLM decision evidence.', input, firstExecution: JSON.parse(JSON.stringify(task)) };
    if (name === '08-save-failure-resume') { await agent.run(task.id, { resume: true }); record.afterResume = JSON.parse(JSON.stringify(task)); }
    if (name === '12-idempotency') {
      const before = task.trace.length; const duplicate = agent.create(input); await agent.run(duplicate.task.id);
      record.repeat = { reused: duplicate.reused, sameTaskId: duplicate.task.id === task.id, beforeTraceCount: before, afterTraceCount: task.trace.length, tasksWithSameKey: agent.store.list().filter(t => t.requestKey === input.requestKey).length };
    }
    fs.writeFileSync(`examples/${name}.json`, JSON.stringify(record, null, 2));
    summaries.push({ case: name, initialStatus: record.firstExecution.status, finalStatus: task.status, finalCost: task.results.plan?.estimate.total ?? null, toolCalls: task.trace.filter(t => t.kind === 'tool').length, code: task.code });
  }
  fs.writeFileSync('examples/summary.json', JSON.stringify({ generatedAt: new Date().toISOString(), mode: 'mock', results: summaries }, null, 2));
  console.table(summaries);
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
