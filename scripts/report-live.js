import fs from 'node:fs';
import path from 'node:path';
import { readLatestLiveEvaluation } from './live-records.js';
import { liveCases } from '../src/live-evaluation.js';

const cell = value => String(value ?? '').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
try {
  const { manifest, records, evaluation } = readLatestLiveEvaluation();
  const lines = ['# 真实模型运行记录', '',
    `- Run：${manifest.runId}`,
    `- 请求模型：${cell(manifest.requestedModel)}`,
    `- 规划策略：${cell(manifest.policyVersion || 'initial-policy')}`,
    `- 行为检查：${evaluation.passed ? '通过' : '未通过'}`,
    '- 业务工具仍为本地合成工具，脚本仍为模板；以下为模型实际选择动作及工具执行结果。',
    '- 公开依据不包含模型内部思维过程。元数据是审计线索，不是服务商真实性证明。', '',
    '| 场景 | 任务状态 | 工具调用 | 最终模拟制作费用 | 行为检查 |',
    '| --- | --- | --- | --- | --- |'
  ];
  for (const item of evaluation.cases) {
    const task = records[item.case]?.task;
    lines.push(`| ${item.case} | ${cell(task?.status || 'missing')} | ${item.toolCalls} | ${task?.results?.plan?.estimate.total ?? '未保存'} | ${item.passed ? '通过' : '未通过'} |`);
  }
  for (const { name } of liveCases) {
    const record = records[name];
    lines.push('', `## ${name}`, '', `原始记录：[${name}.json](runs/${manifest.runId}/${name}.json)。`, '',
      '| 步骤 | 模型选择动作 | 参数 | 工具观察 | 状态 | 后续动作 | 公开行动依据 |',
      '| --- | --- | --- | --- | --- | --- | --- |');
    const trace = record?.task?.trace || [];
    for (const [i, entry] of trace.entries()) {
      const next = trace[i + 1]?.tool || (record.task.status === 'completed' ? '保存成功后运行器结束' : record.task.reason);
      lines.push(`| ${entry.step} | ${cell(entry.tool || entry.kind)} | ${cell(JSON.stringify(entry.arguments || {}))} | ${cell(entry.summary)} | ${cell(entry.status)} | ${cell(next)} | ${cell(entry.reason || '未获得模型响应')} |`);
    }
  }
  lines.push('', '## 历史运行与改进', '',
    '旧的失败记录完整保留，不用最终成功覆盖真实失败。首次提示下，模型提前依据目录费用选轻量方案，没有经历所需的估算观察；明确质量优先策略后，第二轮发生模型请求超时。随后增加有界超时配置，再次实际运行。具体状态以每次 manifest 和原始 Trace 为准。', '',
    '| Run | 请求模型 | 套件状态 |', '| --- | --- | --- |');
  const root = 'examples/live/runs';
  for (const directory of fs.readdirSync(root).sort()) {
    const file = path.join(root, directory, 'manifest.json');
    if (!fs.existsSync(file)) continue;
    const run = JSON.parse(fs.readFileSync(file, 'utf8'));
    lines.push(`| [${run.runId}](runs/${directory}/manifest.json) | ${cell(run.requestedModel)} | ${cell(run.status)} |`);
  }
  fs.writeFileSync('examples/live/README.md', `${lines.join('\n')}\n`);
  console.log(`已生成 examples/live/README.md，原始记录 ${manifest.runId}；行为检查 ${evaluation.passed ? '通过' : '未通过'}。`);
  if (!evaluation.passed) process.exitCode = 1;
} catch {
  console.error('无法生成真实运行报告：缺少完整的 latest 索引与原始记录。');
  process.exitCode = 1;
}
