import { readLatestLiveEvaluation } from './live-records.js';

try {
  const { manifest, evaluation } = readLatestLiveEvaluation();
  console.log(`Run: ${manifest.runId}`);
  for (const result of evaluation.cases) {
    console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.case} (${result.toolCalls} tool calls)`);
    for (const error of result.errors) console.error(`  ${error}`);
  }
  console.log(`不同路径: ${evaluation.distinctPaths}; 同一次运行: ${evaluation.sameRun}`);
  if (!evaluation.passed) process.exitCode = 1;
} catch {
  console.error('未通过：没有可读取的完整真实运行证据。请先配置 .env 并运行 npm run evaluate:live。离线示例不能替代。');
  process.exitCode = 1;
}
