import { catalog } from './tools.js';
import { createHash } from 'node:crypto';

export const observationDigest = trace => createHash('sha256').update(JSON.stringify(trace)).digest('hex');
export const decisionPolicyVersion = 'quality-first-v2';

// This policy is a deterministic test double, not evidence of real LLM reasoning.
export class MockModel {
  mode = 'mock';
  async decide(task) {
    const last = task.trace.at(-1);
    if (task.results.plan) return { tool: 'finish', arguments: {}, reason: '方案已保存，任务完成。' };
    if (last?.status === 'failed' && last.tool === 'save_plan' && task.status !== 'resuming') {
      return { tool: 'stop', arguments: { code: 'tool_failed' }, reason: '保存服务失败，已保留素材、脚本和估算，可从失败步骤续跑。' };
    }
    const premiumIssue = task.trace.some(t => (t.status === 'failed' || t.result?.partial) && (t.arguments.tier === 'premium' || t.arguments.materialId?.startsWith('premium')));
    const premiumEstimate = task.results.estimates.find(e => e.materialId.startsWith('premium'));
    const tier = premiumIssue || (premiumEstimate && !premiumEstimate.feasible) ? 'standard' : 'premium';
    const material = task.results.materials.find(m => m.tier === tier);
    if (!material) return { tool: 'search_materials', arguments: { tier }, reason: tier === 'premium' ? '优先检索高表现力素材，先确认质量和资源。' : '观察到原方案超预算、超时或工具异常，改用轻量素材。' };
    const script = task.results.scripts.find(s => s.materialId === material.id);
    if (!script) return { tool: 'generate_script', arguments: { materialId: material.id }, reason: '素材可用，生成对应的内容脚本。' };
    const estimate = task.results.estimates.find(e => e.scriptId === script.id);
    if (!estimate) return { tool: 'estimate_plan', arguments: { scriptId: script.id }, reason: '脚本已完成，核验素材授权、制作成本与剩余时间。' };
    if (!estimate.feasible) return { tool: 'stop', arguments: { code: estimate.budgetGap ? 'budget_exceeded' : 'deadline_exceeded' }, reason: `轻量方案仍不可行：预算缺口 ${estimate.budgetGap} 单位，时间缺口 ${estimate.timeGapMinutes} 分钟。` };
    return { tool: 'save_plan', arguments: { estimateId: estimate.id }, reason: '预算与时间均满足要求，保存已验证方案。' };
  }
}

const system = `你是内容活动规划 Agent。每轮必须基于最新工具 observation 选择一个动作。不要给出内部思维过程，只给一句可公开的行动依据。输出 JSON：{"tool":"工具名","arguments":{},"reason":"简短依据"}。
工具：search_materials({tier:"premium"|"standard"})；generate_script({materialId})；estimate_plan({scriptId})；save_plan({estimateId})；stop({code:"budget_exceeded"|"deadline_exceeded"|"tool_failed"|"no_feasible_plan"})。
先检索再生成再估算最后保存；只引用 observation 中存在的 id。
业务采用质量优先策略：首次先检索精选素材，生成一版精选脚本，再调用 estimate_plan 验证该方案；只有工具实际返回预算超限、时间不足、错误或无可用素材的部分结果后，才切换轻量素材。不要在首次估算前根据目录价格预取轻量素材或直接跳过精选估算。生成脚本与估算是免费的规划操作，不代表已支付制作费，因此可先验证精选方案。
观察到方案不可行或工具失败时，由你结合最新结果决定替代动作；替代素材也必须生成对应脚本并重新估算后才能保存。保留已经成功的结果。无可行方案则 stop 并说明缺口。保存服务失败应停止等待续跑；resuming 时可以重试保存。禁止将工具失败记为成功。全部费用为预计制作成本，工具调用免费。素材和规则：${JSON.stringify(catalog)}`;

export class OpenAIModel {
  mode = 'openai';
  policyVersion = decisionPolicyVersion;
  constructor(env = process.env) {
    this.key = env.OPENAI_API_KEY;
    this.base = (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
    this.model = env.OPENAI_MODEL || 'gpt-4.1-mini';
    if (!this.key) throw new Error('真实模型模式缺少 OPENAI_API_KEY');
    this.timeoutMs = Number(env.OPENAI_TIMEOUT_MS || 90000);
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1000 || this.timeoutMs > 180000) throw new Error('OPENAI_TIMEOUT_MS 必须为 1000–180000 的整数');
  }
  async decide(task) {
    const observations = structuredClone(task.trace);
    const started = Date.now();
    const response = await fetch(`${this.base}/chat/completions`, {
      method: 'POST', signal: AbortSignal.timeout(this.timeoutMs),
      headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, response_format: { type: 'json_object' }, messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify({ input: task.input, status: task.status, remainingCalls: task.maxSteps - observations.filter(t => t.kind === 'tool').length, successfulResults: task.results, observations }) }
      ] })
    });
    // Do not echo a provider response body: some providers include credentials in errors.
    if (!response.ok) throw new Error(`模型接口错误 HTTP ${response.status}`);
    const data = await response.json();
    const action = JSON.parse(data.choices?.[0]?.message?.content || 'null');
    if (!action || typeof action !== 'object' || Array.isArray(action)) throw new Error('模型未返回有效动作对象');
    // Runtime-generated metadata replaces any similarly named field in model text.
    // Neither credentials nor the full endpoint (which may have query secrets) are recorded.
    return { ...action, modelDecision: {
      source: 'openai-compatible-http', providerHost: new URL(this.base).hostname,
      policyVersion: this.policyVersion, systemPromptDigest: createHash('sha256').update(system).digest('hex'),
      requestedModel: this.model, returnedModel: typeof data.model === 'string' ? data.model : null,
      responseId: typeof data.id === 'string' ? data.id : null,
      requestId: response.headers?.get?.('x-request-id') || null,
      httpStatus: response.status || 200, receivedAt: new Date().toISOString(),
      latencyMs: Date.now() - started, timeoutMs: this.timeoutMs, observationCount: observations.length,
      observationDigest: observationDigest(observations),
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens ?? null,
        completionTokens: data.usage.completion_tokens ?? null,
        totalTokens: data.usage.total_tokens ?? null
      } : null
    } };
  }
}
