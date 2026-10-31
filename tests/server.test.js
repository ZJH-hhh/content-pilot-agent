import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/server.js';
import { MockModel } from '../src/model.js';

async function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-http-'));
  const app = createServer({ directory, model: new MockModel(), stepDelay: 0 });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await Promise.all([...app.agent.active.values()]); await new Promise(resolve => app.server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); });
  return { ...app, base: `http://127.0.0.1:${app.server.address().port}` };
}
test('HTTP creates a real persisted task, exports it, and deduplicates concurrent requests', async t => {
  const { base, agent, store } = await setup(t);
  const body = { theme: '周末城市漫游', budget: 10, deadline: new Date(Date.now() + 86400000).toISOString(), requestKey: 'http-repeat' };
  const responses = await Promise.all([1, 2].map(() => fetch(`${base}/api/tasks`, { method: 'POST', body: JSON.stringify(body) })));
  const [a, b] = await Promise.all(responses.map(r => r.json())); assert.equal(a.task.id, b.task.id);
  await agent.run(a.task.id); assert.equal(store.list().length, 1);
  const exported = await fetch(`${base}/api/tasks/${a.task.id}/export`); const task = await exported.json();
  assert.match(exported.headers.get('content-disposition'), /attachment/); assert.equal(task.status, 'completed'); assert.equal(task.results.plan.estimate.total, 8);
  assert.equal(task.trace.filter(e => e.kind === 'tool').length, 7);
});
test('HTTP input errors, missing task and unknown route are explicit', async t => {
  const { base } = await setup(t);
  assert.equal((await fetch(`${base}/api/tasks`, { method: 'POST', body: 'bad json' })).status, 400);
  assert.equal((await fetch(`${base}/api/tasks/0000`)).status, 404);
  assert.equal((await fetch(`${base}/api/unknown`)).status, 404);
  assert.equal((await fetch(`${base}/api/tasks`, { method: 'POST', body: JSON.stringify({ theme: '缺预算' }) })).status, 202);
  assert.equal((await (await fetch(`${base}/api/tasks`)).json()).tasks[0].status, 'needs_input');
});
test('web UI and catalog load without external dependencies or leaking configuration', async t => {
  const { base } = await setup(t);
  const home = await fetch(base); assert.equal(home.status, 200); assert.match(await home.text(), /Content Pilot/);
  assert.ok(home.headers.get('content-security-policy').includes("script-src 'self'"));
  const config = await (await fetch(`${base}/api/config`)).json(); assert.equal(config.mode, 'mock'); assert.equal(config.catalog.materials.length, 3); assert.equal('OPENAI_API_KEY' in config, false);
  for (const file of ['/app.js', '/styles.css', '/favicon.svg']) assert.equal((await fetch(`${base}${file}`)).status, 200);
});
test('server restart converts interrupted task to explicit resumable status', async t => {
  const { store } = await setup(t);
  const task = { id: '0000', status: 'running', createdAt: new Date().toISOString(), trace: [], results: { materials: [], scripts: [], estimates: [], plan: null } };
  store.put(task);
  const restarted = createServer({ directory: store.directory, model: new MockModel(), stepDelay: 0 });
  assert.equal(restarted.store.get(task.id).status, 'incomplete'); assert.equal(restarted.store.get(task.id).code, 'process_interrupted');
});
