import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Agent } from '../src/agent.js';
import { OpenAIModel } from '../src/model.js';
import { Store } from '../src/store.js';
import { evaluateLiveCase, evaluateLiveSuite, liveCases } from '../src/live-evaluation.js';

if (!process.env.OPENAI_API_KEY) {
  console.error('未运行：缺少 OPENAI_API_KEY。不会生成或伪造真实模型结果。请配置 .env 后执行 npm run evaluate:live。');
  process.exitCode = 1;
} else {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-live-'));
  const model = new OpenAIModel();
  const agent = new Agent(new Store(dir), { model, onStep: task => {
    const entry = task.trace.at(-1);
    console.log(`  step ${entry.step} ${entry.tool} [${entry.status}]: ${entry.summary}`);
  } });
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const output = path.join('examples/live/runs', runId);
  fs.mkdirSync(output, { recursive: true });
  const records = {};
  const manifest = { schemaVersion: 2, runId, status: 'running', startedAt: new Date().toISOString(), requestedModel: model.model, policyVersion: model.policyVersion, cases: [] };
  const saveManifest = () => fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
  saveManifest();
  fs.writeFileSync('examples/live/latest.json', JSON.stringify({ runId, manifest: `runs/${runId}/manifest.json` }, null, 2));
  try {
    for (const { name, budget, scenario } of liveCases) {
      const { task } = agent.create({ theme: '城市漫游 · 发现身边的美好', budget, deadline: new Date(Date.now() + 86400000).toISOString(), scenario });
      await agent.run(task.id);
      const record = { schemaVersion: 2, evidenceSource: 'live-api', runId, case: name, model: model.model, disclosure: 'Live model execution; local synthetic business tools. Runtime metadata is not provider authenticity proof.', task };
      records[name] = record;
      const evaluation = evaluateLiveCase(name, record);
      fs.writeFileSync(path.join(output, `${name}.json`), JSON.stringify(record, null, 2));
      manifest.cases.push(evaluation); saveManifest();
      console.log(`${name}: ${task.status}, ${task.trace.length} trace entries, total=${task.results.plan?.estimate.total ?? 'not saved'}`);
      for (const error of evaluation.errors) console.error(`  FAIL ${error}`);
    }
    const evaluation = evaluateLiveSuite(records);
    manifest.status = evaluation.passed ? 'passed' : 'failed';
    manifest.finishedAt = new Date().toISOString();
    manifest.evaluation = evaluation; saveManifest();
    console.log(`行为验收: ${manifest.status}; 记录: ${output}`);
    if (!evaluation.passed) process.exitCode = 1;
  } catch {
    manifest.status = 'failed'; manifest.error = '评估意外中断；已保留实际产物，请检查配置、连接与服务端。'; saveManifest();
    console.error(manifest.error); process.exitCode = 1;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
