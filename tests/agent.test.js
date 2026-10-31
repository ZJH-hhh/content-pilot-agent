import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Agent, InputError, validateInput } from '../src/agent.js';
import { Store } from '../src/store.js';
import { MockModel, OpenAIModel, observationDigest } from '../src/model.js';
import { executeTool } from '../src/tools.js';

const NOW = Date.parse('2026-10-31T12:00:00Z');
const input = { theme: '城市漫游活动', budget: 10, deadline: '2026-11-01T12:00:00Z' };
function setup(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new Store(dir);
  const agent = new Agent(store, { now: () => NOW, model: new MockModel(), ...options });
  return { agent, store, dir, create: extra => agent.create({ ...input, ...extra }).task };
}

test('budget replan observes 12, selects 8, saves only a feasible plan', async t => {
  const { agent, create } = setup(t); const task = create(); await agent.run(task.id);
  assert.equal(task.status, 'completed'); assert.equal(task.results.plan.estimate.total, 8);
  assert.deepEqual(task.results.estimates.map(e => e.total), [12, 8]);
  assert.equal(task.results.estimates[0].budgetGap, 2);
  assert.deepEqual(task.trace.filter(e => e.tool === 'search_materials').map(e => e.arguments.tier), ['premium', 'standard']);
  assert.equal(task.results.scripts.length, 2);
  assert.equal(task.results.plan.estimate.items.reduce((n, i) => n + i.amount, 0), 8);
});
test('normal sufficient-budget path uses premium without unnecessary alternative', async t => {
  const { agent, create } = setup(t); const task = create({ budget: 15 }); await agent.run(task.id);
  assert.equal(task.status, 'completed'); assert.equal(task.results.plan.estimate.total, 12); assert.equal(task.trace.length, 4);
});
for (const field of ['budget', 'deadline']) test(`missing ${field} never calls model or tools`, async t => {
  let calls = 0;
  const { agent, create } = setup(t, { model: { mode: 'mock', decide: async () => { calls++; } } });
  const task = create({ [field]: undefined }); await agent.run(task.id);
  assert.equal(task.status, 'needs_input'); assert.equal(task.trace.length, 0); assert.equal(calls, 0); assert.equal(task.results.plan, null);
});
test('input rejects nonfinite budget, empty theme, past date, and ambiguous timezone', () => {
  for (const extra of [{ budget: NaN }, { budget: Infinity }, { budget: 0 }, { budget: -1 }, { budget: '10' }, { theme: '' }, { deadline: '2026-10-30T00:00:00Z' }, { deadline: '2026-11-01' }]) assert.ok(validateInput({ ...input, ...extra }, NOW).length);
});
test('tool failure leads to a different material and preserves successful premium search', async t => {
  const { agent, create } = setup(t); const task = create({ scenario: 'tool_failure' }); await agent.run(task.id);
  assert.equal(task.status, 'completed'); assert.ok(task.results.materials.some(m => m.tier === 'premium'));
  const failure = task.trace.findIndex(e => e.status === 'failed');
  assert.equal(task.trace[failure].tool, 'generate_script'); assert.equal(task.trace[failure + 1].arguments.tier, 'standard');
  assert.equal(task.results.scripts.length, 1); assert.equal(task.trace[failure].result.ok, false);
});
test('partially successful material search is not mistaken for usable assets', async t => {
  const { agent, create } = setup(t); const task = create({ scenario: 'partial' }); await agent.run(task.id);
  assert.equal(task.trace[0].status, 'partial'); assert.deepEqual(task.trace[0].result.materials, []);
  assert.equal(task.trace[1].arguments.tier, 'standard'); assert.equal(task.results.plan.estimate.total, 8);
});
test('no affordable alternative stops with a concrete gap and no saved plan', async t => {
  const { agent, create } = setup(t); const task = create({ budget: 5 }); await agent.run(task.id);
  assert.equal(task.status, 'incomplete'); assert.equal(task.code, 'budget_exceeded'); assert.equal(task.results.plan, null);
  assert.equal(task.results.estimates.at(-1).budgetGap, 3); assert.match(task.reason, /3 单位/);
  assert.ok(!task.trace.some(e => e.tool === 'save_plan'));
});
test('deadline drives replan even when premium is affordable', async t => {
  const { agent, create } = setup(t); const task = create({ budget: 15, deadline: new Date(NOW + 60 * 60000).toISOString() }); await agent.run(task.id);
  assert.equal(task.status, 'completed'); assert.equal(task.results.plan.material.tier, 'standard'); assert.equal(task.results.estimates[0].timeGapMinutes, 30);
});
test('no timely alternative stops with actual time shortfall', async t => {
  const { agent, create } = setup(t); const task = create({ deadline: new Date(NOW + 30 * 60000).toISOString() }); await agent.run(task.id);
  assert.equal(task.code, 'deadline_exceeded'); assert.equal(task.results.estimates.at(-1).timeGapMinutes, 15); assert.equal(task.results.plan, null);
});
test('repeated request has the same id, trace count and production total', async t => {
  const { agent, create } = setup(t); const task = create({ requestKey: 'same-click' }); await agent.run(task.id); const count = task.trace.length;
  const result = agent.create({ ...input, requestKey: 'same-click' }); await agent.run(result.task.id);
  assert.equal(result.reused, true); assert.equal(result.task.id, task.id); assert.equal(result.task.trace.length, count); assert.equal(task.results.plan.estimate.total, 8);
});
test('same idempotency key with different input is a conflict', t => {
  const { agent, create } = setup(t); create({ requestKey: 'key' });
  assert.throws(() => agent.create({ ...input, budget: 20, requestKey: 'key' }), error => error instanceof InputError && error.status === 409);
});
test('save failure preserves results and resumes only the missing save', async t => {
  const { agent, create, dir } = setup(t); const task = create({ scenario: 'save_failure' }); await agent.run(task.id);
  assert.equal(task.status, 'incomplete'); assert.equal(task.code, 'tool_failed'); assert.equal(task.results.plan, null);
  const stopSummary = task.trace.at(-1).summary;
  assert.match(stopSummary, /保存服务失败/);
  const oldScripts = JSON.stringify(task.results.scripts); const oldTrace = task.trace.length;
  const restarted = new Agent(new Store(dir), { model: new MockModel(), now: () => NOW });
  const resumed = await restarted.run(task.id, { resume: true });
  assert.equal(resumed.status, 'completed'); assert.equal(resumed.trace.length, oldTrace + 1); assert.equal(resumed.trace.at(-1).tool, 'save_plan');
  assert.equal(JSON.stringify(resumed.results.scripts), oldScripts); assert.equal(resumed.attempts, 2);
  assert.equal(resumed.trace.filter(e => e.tool === 'save_plan' && e.status === 'failed').length, 1);
  assert.equal(resumed.trace.find(e => e.tool === 'stop').summary, stopSummary);
});
test('total tool-call cap includes failures and cannot be reset by resuming', async t => {
  const { agent, create } = setup(t); const task = create({ maxSteps: 3 }); await agent.run(task.id);
  assert.equal(task.code, 'step_limit'); assert.equal(task.trace.length, 3); await agent.run(task.id, { resume: true });
  assert.equal(task.trace.length, 3); assert.equal(task.status, 'incomplete'); assert.equal(task.results.plan, null);
});
test('unknown model actions stop safely with model_error', async t => {
  const { agent, create } = setup(t, { model: { mode: 'mock', decide: async () => ({ tool: 'delete_everything', arguments: {}, reason: 'invalid' }) } });
  const task = create(); await agent.run(task.id); assert.equal(task.code, 'model_error'); assert.equal(task.results.plan, null);
});
test('provider outage preserves state, never silently falls back to mock', async t => {
  const { agent, create } = setup(t, { model: { mode: 'openai', decide: async () => { throw new Error('模型接口错误 HTTP 503'); } } });
  const task = create(); await agent.run(task.id); assert.equal(task.mode, 'openai'); assert.equal(task.code, 'model_error'); assert.equal(task.results.plan, null);
});
test('dependency guards block missing material, missing script, and missing estimate', t => {
  const { create } = setup(t); const task = create();
  for (const [tool, args] of [['generate_script', { materialId: 'made-up' }], ['estimate_plan', { scriptId: 'made-up' }], ['save_plan', { estimateId: 'made-up' }]]) assert.throws(() => executeTool(task, { tool, arguments: args }, NOW), /依赖缺失/);
});
test('save tool independently blocks unaffordable plan despite model attempting save', t => {
  const { create } = setup(t); const task = create();
  executeTool(task, { tool: 'search_materials', arguments: { tier: 'premium' } }, NOW);
  executeTool(task, { tool: 'generate_script', arguments: { materialId: 'premium-city' } }, NOW);
  executeTool(task, { tool: 'estimate_plan', arguments: { scriptId: 'script-premium-city' } }, NOW);
  assert.throws(() => executeTool(task, { tool: 'save_plan', arguments: { estimateId: 'estimate-script-premium-city' } }, NOW), /预算超限/);
  assert.equal(task.results.plan, null);
});
test('save rechecks remaining deadline rather than trusting old feasible estimate', t => {
  const { create } = setup(t); const task = create({ budget: 15 });
  executeTool(task, { tool: 'search_materials', arguments: { tier: 'premium' } }, NOW);
  executeTool(task, { tool: 'generate_script', arguments: { materialId: 'premium-city' } }, NOW);
  executeTool(task, { tool: 'estimate_plan', arguments: { scriptId: 'script-premium-city' } }, NOW);
  assert.throws(() => executeTool(task, { tool: 'save_plan', arguments: { estimateId: 'estimate-script-premium-city' } }, Date.parse(task.input.deadline) - 1000), /剩余时间不足/);
});
test('real adapter requires explicit credentials', () => assert.throws(() => new OpenAIModel({}), /OPENAI_API_KEY/));
test('model timeout is bounded, configurable, and rejects invalid limits', () => {
  const env = { OPENAI_API_KEY: 'test-only-placeholder' };
  assert.equal(new OpenAIModel(env).timeoutMs, 90000);
  assert.equal(new OpenAIModel({ ...env, OPENAI_TIMEOUT_MS: '120000' }).timeoutMs, 120000);
  for (const value of ['0', 'NaN', '180001', '1234.5']) assert.throws(() => new OpenAIModel({ ...env, OPENAI_TIMEOUT_MS: value }), /OPENAI_TIMEOUT_MS/);
});
test('theme retrieval ranks relevant product assets ahead of city assets', async t => {
  const { agent, create } = setup(t); const task = create({ theme: '新品发布与产品预热', budget: 15 }); await agent.run(task.id);
  assert.equal(task.results.plan.material.id, 'premium-studio');
});
test('failed tool calls count toward the cap', async t => {
  const { agent, create } = setup(t); const task = create({ scenario: 'tool_failure', maxSteps: 2 }); await agent.run(task.id);
  assert.equal(task.code, 'step_limit'); assert.equal(task.trace.filter(e => e.kind === 'tool').length, 2);
  assert.equal(task.trace.at(-1).status, 'failed'); assert.equal(task.results.scripts.length, 0);
});
test('concurrent run requests share one execution rather than duplicating steps', async t => {
  const { agent, create } = setup(t); const task = create(); await Promise.all([agent.run(task.id), agent.run(task.id), agent.run(task.id)]);
  assert.equal(task.status, 'completed'); assert.equal(task.attempts, 1); assert.equal(task.trace.filter(e => e.tool === 'save_plan').length, 1);
});
test('real adapter consumes each fresh observation via HTTP, with mock transport only', async t => {
  const originalFetch = globalThis.fetch; const requests = [];
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    const action = requests.length === 1 ? { tool: 'search_materials', arguments: { tier: 'premium' }, reason: '检索' } : { tool: 'stop', arguments: { code: 'no_feasible_plan' }, reason: '测试传输协议' };
    return { ok: true, status: 200, headers: new Headers({ 'x-request-id': `test-request-${requests.length}` }), json: async () => ({ id: `test-response-${requests.length}`, model: 'test-model-returned', usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }, choices: [{ message: { content: JSON.stringify({ ...action, modelDecision: { source: 'forged-by-model-text' } }) } }] }) };
  };
  const model = new OpenAIModel({ OPENAI_API_KEY: 'test-only-placeholder', OPENAI_BASE_URL: 'https://example.invalid/v1', OPENAI_MODEL: 'test-model' });
  const { agent, create } = setup(t, { model }); const task = create(); await agent.run(task.id);
  assert.equal(requests.length, 2); assert.equal(JSON.parse(requests[1].body.messages[1].content).observations[0].tool, 'search_materials');
  assert.equal(JSON.parse(requests[0].body.messages[1].content).observations.length, 0);
  assert.equal(task.mode, 'openai');
  assert.equal(task.trace[1].modelDecision.observationDigest, observationDigest(task.trace.slice(0, 1)));
  assert.equal(task.trace[1].modelDecision.requestId, 'test-request-2');
  assert.equal(task.trace[1].modelDecision.returnedModel, 'test-model-returned');
  assert.equal(task.trace[1].modelDecision.source, 'openai-compatible-http');
  assert.equal(task.trace[1].modelDecision.policyVersion, 'quality-first-v2');
  assert.match(task.trace[1].modelDecision.systemPromptDigest, /^[a-f\d]{64}$/);
  assert.equal(task.trace[1].modelDecision.usage.totalTokens, 15);
  assert.equal(JSON.stringify(task).includes('test-only-placeholder'), false);
});
