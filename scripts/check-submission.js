import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { readLatestLiveEvaluation } from './live-records.js';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const submission = read('docs/submission.json');
const contribution = read('docs/contribution.json');
let live = { passed: false, detail: '尚无完整真实模型运行证据。' };
try {
  const { manifest, evaluation } = readLatestLiveEvaluation();
  live = { passed: evaluation.passed, runId: manifest.runId, detail: evaluation.passed ? '三条真实接口路径的一致性与行为检查通过；仍建议人工复核公开决策依据。' : '真实记录存在，但未全部通过行为检查。' };
} catch { /* Absence is an explicit unmet requirement, not an exception to waive. */ }

let resolvedCommitSha = submission.github?.commitSha;
if (submission.github?.commitShaSource === 'git-head') {
  try {
    const origin = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().replace(/\.git$/, '');
    if (origin === submission.github.url) resolvedCommitSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { /* A ZIP has no Git metadata; the external delivery receipt records its SHA. */ }
}
const githubDeclared = typeof submission.topicNumber === 'string' && submission.topicNumber.trim()
  && /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/?$/.test(submission.github?.url || '')
  && /^[a-f\d]{40}$/i.test(resolvedCommitSha || '')
  && submission.github?.reviewerAccessConfirmed === true;
const personalDeclared = contribution.confirmedByCandidate === true
  && Array.isArray(contribution.codeModifications) && Array.isArray(contribution.personalVerifications)
  && ((Number.isFinite(contribution.actualMinutes) && contribution.actualMinutes >= 0)
    || (Number.isFinite(contribution.actualDuration?.value) && contribution.actualDuration.value > 0
      && ['days', 'hours', 'minutes'].includes(contribution.actualDuration.unit)
      && typeof contribution.actualDuration.reportedText === 'string' && contribution.actualDuration.reportedText.trim()))
  && Array.isArray(contribution.unfinishedItems);
const result = {
  checkedAt: new Date().toISOString(), deliveryFormat: submission.deliveryFormat,
  liveModel: live,
  github: { passed: Boolean(githubDeclared), url: submission.github?.url, commitSha: resolvedCommitSha || null, reviewerAccessConfirmed: submission.github?.reviewerAccessConfirmed === true, verification: 'SHA 从当前仓库 HEAD 或静态交付字段读取；远程 SHA、仓库可读性与评审访问应分别核实。', detail: githubDeclared ? '提交字段已提供，仍需核对远程仓库。' : submission.remotePublishingRequested ? '已授权创建上传；仓库 URL、最终 SHA 或评审访问仍有未完成项。' : '尚未提供完整 GitHub 提交信息。' },
  personalDisclosure: { passed: personalDeclared, verification: '本人事实声明；明确区分 AI 辅助与本人手动验证。', detail: personalDeclared ? '本人已确认借助 AI 实现全部功能、投入 2 天；验证执行方式与未完成项已披露。' : contribution.candidateStatement ? '已收到实现范围声明，贡献或耗时字段仍不完整。' : '个人贡献声明尚未完整提供。' },
  formalSubmissionComplete: Boolean(live.passed && githubDeclared && personalDeclared)
};
fs.mkdirSync('examples', { recursive: true });
fs.writeFileSync('examples/submission-status.json', JSON.stringify(result, null, 2));
for (const [label, value] of [['真实模型行为证据', result.liveModel], ['GitHub 提交规范', result.github], ['个人贡献披露', result.personalDisclosure]]) console.log(`${value.passed ? 'PASS' : 'PENDING'} ${label}: ${value.detail}`);
console.log(`正式材料检查: ${result.formalSubmissionComplete ? '字段齐全（仍需人工核对）' : '尚未全部满足'}`);
if (!result.formalSubmissionComplete) process.exitCode = 1;
