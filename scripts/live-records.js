import fs from 'node:fs';
import path from 'node:path';
import { evaluateLiveSuite, liveCases } from '../src/live-evaluation.js';

export function readLatestLiveEvaluation(root = 'examples/live') {
  const directory = path.resolve(root);
  const pointer = JSON.parse(fs.readFileSync(path.join(directory, 'latest.json'), 'utf8'));
  const file = path.resolve(directory, pointer.manifest || '');
  if (!file.startsWith(`${directory}${path.sep}`)) throw new Error('真实运行索引路径无效');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  const runDirectory = path.dirname(file);
  const records = {};
  for (const { name } of liveCases) {
    const recordPath = path.join(runDirectory, `${name}.json`);
    records[name] = fs.existsSync(recordPath) ? JSON.parse(fs.readFileSync(recordPath, 'utf8')) : null;
  }
  const evaluation = evaluateLiveSuite(records);
  if (manifest.runId !== pointer.runId || liveCases.some(({ name }) => records[name]?.runId !== manifest.runId)) evaluation.passed = false;
  return { manifest, records, evaluation };
}
