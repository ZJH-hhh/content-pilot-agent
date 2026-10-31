import { randomUUID } from 'node:crypto';
import { executeTool, toolNames } from './tools.js';
import { MockModel, OpenAIModel } from './model.js';

export class InputError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
export function validateInput(input, now = Date.now()) {
  const errors = [];
  if (typeof input.theme !== 'string' || !input.theme.trim() || input.theme.length > 120) errors.push('主题必填，且不能超过 120 字');
  if (typeof input.budget !== 'number' || !Number.isFinite(input.budget) || input.budget <= 0 || input.budget > 1000000) errors.push('请填写大于 0 的有效预算');
  if (typeof input.deadline !== 'string' || !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(input.deadline) || !Number.isFinite(Date.parse(input.deadline))) errors.push('请填写包含时区的截止时间');
  else if (Date.parse(input.deadline) <= now) errors.push('截止时间必须晚于当前时间');
  return errors;
}
export class Agent {
  constructor(store, { model, now = () => Date.now(), onStep = () => {} } = {}) {
    this.store = store;
    this.model = model || (process.env.AGENT_MODEL_MODE === 'openai' ? new OpenAIModel() : new MockModel());
    this.now = now;
    this.onStep = onStep;
    this.active = new Map();
  }
  create(body) {
    const input = { theme: body.theme?.trim?.() ?? body.theme, budget: body.budget, deadline: body.deadline };
    const requestKey = body.requestKey || randomUUID();
    if (typeof requestKey !== 'string' || requestKey.length > 150) throw new InputError('requestKey 无效');
    const previous = this.store.byKey(requestKey);
    if (previous) {
      if (JSON.stringify(previous.input) !== JSON.stringify(input)) throw new InputError('同一个请求编号不能用于不同输入', 409);
      return { task: previous, reused: true };
    }
    const maxSteps = body.maxSteps ?? 12;
    if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 32) throw new InputError('maxSteps 必须为 1–32 的整数');
    const scenarios = { normal: null, tool_failure: { tool: 'generate_script', kind: 'error', consumed: false }, partial: { tool: 'search_materials', kind: 'partial', consumed: false }, save_failure: { tool: 'save_plan', kind: 'error', consumed: false } };
    if (!Object.hasOwn(scenarios, body.scenario || 'normal')) throw new InputError('未知测试场景');
    const errors = validateInput(input, this.now());
    const task = { id: randomUUID(), requestKey, input, maxSteps, scenario: body.scenario || 'normal', injection: scenarios[body.scenario || 'normal'], mode: this.model.mode,
      status: errors.length ? 'needs_input' : 'queued', reason: errors.join('；'), code: errors.length ? 'missing_or_invalid_input' : null,
      createdAt: new Date(this.now()).toISOString(), updatedAt: new Date(this.now()).toISOString(), attempts: 0,
      trace: [], results: { materials: [], scripts: [], estimates: [], plan: null } };
    this.store.put(task);
    return { task, reused: false };
  }
  run(id, { resume = false } = {}) {
    if (this.active.has(id)) return this.active.get(id);
    const promise = this._run(id, resume).finally(() => this.active.delete(id));
    this.active.set(id, promise);
    return promise;
  }
  async _run(id, resume) {
    const task = this.store.get(id);
    if (!task) throw new InputError('任务不存在', 404);
    if (task.status === 'completed' || task.status === 'needs_input') return task;
    if (!resume && !['queued', 'running'].includes(task.status)) return task;
    const errors = validateInput(task.input, this.now());
    if (errors.length) { task.status = 'incomplete'; task.reason = errors.join('；'); task.code = 'deadline_exceeded'; return this.store.put(task); }
    task.attempts++;
    task.status = resume ? 'resuming' : 'running';
    task.code = null;
    let initialResume = resume;
    // The cap applies to total tool calls across resumes, including failed calls.
    while (task.trace.filter(t => t.kind === 'tool').length < task.maxSteps) {
      let action;
      try {
        action = await this.model.decide(task);
        if (!action || ![...toolNames, 'stop', 'finish'].includes(action.tool) || typeof action.reason !== 'string' || !action.reason.trim() || action.reason.length > 1000 || !action.arguments || Array.isArray(action.arguments) || typeof action.arguments !== 'object') throw new Error('模型动作格式无效');
      } catch (error) {
        task.trace.push({ kind: 'model_error', step: task.trace.length + 1, status: 'failed', summary: error.message, at: new Date(this.now()).toISOString() });
        task.status = 'incomplete'; task.code = 'model_error'; task.reason = error.message; break;
      }
      if (['stop', 'finish'].includes(action.tool)) {
        task.trace.push({ kind: 'decision', step: task.trace.length + 1, tool: action.tool, arguments: action.arguments, reason: action.reason, summary: action.reason, status: 'observed', ...(action.modelDecision ? { modelDecision: action.modelDecision } : {}), at: new Date(this.now()).toISOString() });
        task.status = task.results.plan ? 'completed' : 'incomplete'; task.reason = action.reason; task.code = task.results.plan ? null : (action.arguments.code || 'no_feasible_plan'); break;
      }
      if (initialResume) { task.status = 'running'; initialResume = false; }
      const entry = { kind: 'tool', step: task.trace.length + 1, tool: action.tool, arguments: action.arguments, reason: action.reason, ...(action.modelDecision ? { modelDecision: action.modelDecision } : {}), at: new Date(this.now()).toISOString() };
      try { entry.result = executeTool(task, action, this.now()); entry.status = entry.result.partial ? 'partial' : 'success'; entry.summary = entry.result.summary; }
      catch (error) { entry.status = 'failed'; entry.result = { ok: false, error: error.message }; entry.summary = error.message; }
      task.trace.push(entry);
      task.updatedAt = new Date(this.now()).toISOString();
      this.store.put(task);
      await this.onStep(task);
      if (task.results.plan) { task.status = 'completed'; task.code = null; task.reason = '内容方案已保存，可导出完整方案。'; break; }
    }
    if (['running', 'resuming'].includes(task.status)) { task.status = 'incomplete'; task.code = 'step_limit'; task.reason = `达到总工具调用上限 ${task.maxSteps}，任务未完成；已保留成功步骤。`; }
    task.updatedAt = new Date(this.now()).toISOString();
    return this.store.put(task);
  }
}
