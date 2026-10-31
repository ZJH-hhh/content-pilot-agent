import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Agent } from '../src/agent.js';
import { MockModel, observationDigest } from '../src/model.js';
import { Store } from '../src/store.js';
import { evaluateLiveCase, evaluateLiveSuite, liveCases } from '../src/live-evaluation.js';

// Synthetic in-memory fixtures exercise the verifier; they are never exported
// into examples/live and are NOT evidence of any real model execution.
const NOW = Date.parse('2026-10-31T12:00:00Z');
async function fixture(t, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-evidence-unit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const definition = liveCases.find(c => c.name === name);
  const agent = new Agent(new Store(dir), { model: new MockModel(), now: () => NOW });
  const { task } = agent.create({ theme: '城市漫游', budget: definition.budget, deadline: '2026-11-01T12:00:00Z', scenario: definition.scenario });
  await agent.run(task.id);
  task.mode = 'openai';
  const record = { schemaVersion: 2, evidenceSource: 'live-api', runId: 'synthetic-unit-fixture-not-live', disclosure: 'SYNTHETIC UNIT FIXTURE, NOT LIVE EVIDENCE', task };
  return restamp(record);
}
function restamp(record) {
  record.task.trace.forEach((e, i, trace) => {
    e.step = i + 1;
    e.modelDecision = { source: 'openai-compatible-http', httpStatus: 200, providerHost: 'synthetic.invalid', requestedModel: 'synthetic-test-model', observationCount: i, observationDigest: observationDigest(trace.slice(0, i)) };
  });
  return record;
}
const failureNames = result => result.checks.filter(c => !c.passed).map(c => c.name);

test('synthetic valid paths pass behavior checker without being presented as live records', async t => {
  for (const { name } of liveCases) {
    const result = evaluateLiveCase(name, await fixture(t, name));
    assert.equal(result.passed, true, result.errors.join('\n'));
  }
});
test('a completed direct-lightweight path does not prove observing and changing an over-budget plan', async t => {
  const record = await fixture(t, 'budget-replan');
  record.task.trace = record.task.trace.slice(3); restamp(record);
  assert.equal(record.task.status, 'completed');
  const result = evaluateLiveCase('budget-replan', record);
  assert.equal(result.passed, false); assert.ok(failureNames(result).includes('observed_12_then_changed_action'));
});
test('completed task without a real failed step cannot pass the tool-failure case', async t => {
  const record = await fixture(t, 'tool-failure');
  record.task.trace = record.task.trace.filter(e => e.status !== 'failed'); restamp(record);
  assert.equal(record.task.status, 'completed');
  assert.ok(failureNames(evaluateLiveCase('tool-failure', record)).includes('failure_observed_then_alternative'));
});
test('offline mode and missing HTTP runtime metadata cannot count as real evidence', async t => {
  const record = await fixture(t, 'normal'); record.task.mode = 'mock';
  assert.ok(failureNames(evaluateLiveCase('normal', record)).includes('live_record'));
  record.task.mode = 'openai'; delete record.task.trace[0].modelDecision;
  assert.ok(failureNames(evaluateLiveCase('normal', record)).includes('fresh_model_observations'));
});
test('stale observations or modified earlier results invalidate observation digests', async t => {
  const record = await fixture(t, 'budget-replan'); record.task.trace[3].modelDecision.observationCount = 0;
  assert.ok(failureNames(evaluateLiveCase('budget-replan', record)).includes('fresh_model_observations'));
  restamp(record); record.task.trace[0].summary = 'changed afterwards';
  assert.ok(failureNames(evaluateLiveCase('budget-replan', record)).includes('fresh_model_observations'));
});
test('failed result relabeled as success is rejected even when final plan is completed', async t => {
  const record = await fixture(t, 'tool-failure'); record.task.trace.find(e => e.status === 'failed').status = 'success'; restamp(record);
  const result = evaluateLiveCase('tool-failure', record);
  assert.equal(result.passed, false); assert.ok(failureNames(result).includes('tool_results_and_dependencies'));
});
test('dropping successful premium results after replanning is rejected', async t => {
  const record = await fixture(t, 'budget-replan'); record.task.results.materials = record.task.results.materials.filter(m => m.tier === 'standard');
  assert.ok(failureNames(evaluateLiveCase('budget-replan', record)).includes('successful_artifacts_retained'));
});
test('fabricated final cost and detached plan ids are rejected', async t => {
  const record = await fixture(t, 'budget-replan'); record.task.results.plan.estimate.total = 1; record.task.results.plan.id = 'unrelated-plan';
  assert.ok(failureNames(evaluateLiveCase('budget-replan', record)).includes('saved_plan_consistency'));
});
test('over-budget saved plans and changed deadlines are rejected', async t => {
  const record = await fixture(t, 'normal'); record.task.input.deadline = new Date(NOW + 30000).toISOString();
  assert.ok(failureNames(evaluateLiveCase('normal', record)).includes('saved_plan_consistency'));
});
test('missing or mixed evaluation runs fail the suite gate', async t => {
  const records = {};
  for (const { name } of liveCases) records[name] = await fixture(t, name);
  assert.equal(evaluateLiveSuite(records).passed, true);
  records['tool-failure'].runId = 'another-run'; assert.equal(evaluateLiveSuite(records).sameRun, false);
  delete records['tool-failure']; assert.equal(evaluateLiveSuite(records).passed, false);
});
test('unknown case and empty input report failed checks instead of passing', () => {
  assert.equal(evaluateLiveCase('unknown', {}).passed, false);
  assert.equal(evaluateLiveCase('normal', null).passed, false);
});
