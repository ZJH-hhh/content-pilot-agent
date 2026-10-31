import { isDeepStrictEqual } from 'node:util';
import { observationDigest } from './model.js';
import { catalog } from './tools.js';

export const liveCases = [
  { name: 'normal', budget: 15, scenario: 'normal' },
  { name: 'budget-replan', budget: 10, scenario: 'normal' },
  { name: 'tool-failure', budget: 10, scenario: 'tool_failure' }
];

// This checks the submitted behavior and runtime metadata, not provider authenticity.
// Metadata is an audit aid, not a signature or proof that a provider runs a real LLM.
export function evaluateLiveCase(name, record) {
  const checks = [];
  const check = (name, passed, detail) => checks.push({ name, passed: Boolean(passed), detail });
  const expected = liveCases.find(c => c.name === name);
  const task = record?.task;
  const trace = Array.isArray(task?.trace) ? task.trace : [];
  const tools = trace.filter(e => e.kind === 'tool');
  const plan = task?.results?.plan;
  check('known_case', expected, '仅接受 normal、budget-replan、tool-failure 三种评估场景。');
  check('live_record', record?.schemaVersion === 2 && record?.evidenceSource === 'live-api' && task?.mode === 'openai', '必须是明确标识的真实接口运行记录；离线 Mock 不能充当真实证据。');
  check('expected_input', expected && task?.input?.budget === expected.budget && task?.scenario === expected.scenario, '输入预算与故障场景必须符合对应验收用例。');
  check('completed_with_saved_plan', task?.status === 'completed' && plan, '任务完成且存在实际保存方案。');
  check('bounded_calls', tools.length > 0 && Number.isInteger(task?.maxSteps) && tools.length <= task.maxSteps, '包括失败调用在内的工具次数不得超限。');
  check('sequential_trace', trace.length > 0 && trace.every((e, i) => e.step === i + 1 && typeof e.reason === 'string' && e.reason.trim() && typeof e.summary === 'string' && e.summary.trim()), '每步有顺序编号、公开依据和当时的观察摘要。');
  check('fresh_model_observations', trace.length > 0 && trace.every((e, i) => {
    const m = e.modelDecision;
    return m?.source === 'openai-compatible-http' && m.httpStatus === 200 && typeof m.requestedModel === 'string' && m.requestedModel.trim()
      && typeof m.providerHost === 'string' && m.providerHost.trim()
      && m.observationCount === i && m.observationDigest === observationDigest(trace.slice(0, i));
  }), '每次动作须携带运行器写入的模型信息，观察数量及哈希须对应该步之前的完整 Trace。');

  const materials = new Map(); const scripts = new Map(); const estimates = new Map();
  let dependenciesValid = true; let savedId = null;
  for (const entry of tools) {
    const args = entry.arguments || {}; const result = entry.result;
    if (entry.status === 'failed') { if (result?.ok !== false) dependenciesValid = false; continue; }
    if (entry.status === 'partial') { if (!result?.partial || result.ok !== true) dependenciesValid = false; continue; }
    if (entry.status !== 'success' || result?.ok !== true) { dependenciesValid = false; continue; }
    if (entry.tool === 'search_materials') {
      if (!Array.isArray(result.materials) || !result.materials.length) dependenciesValid = false;
      for (const material of result.materials || []) {
        const source = catalog.materials.find(m => m.id === material.id);
        if (!source || !isDeepStrictEqual(source, material) || material.tier !== args.tier) dependenciesValid = false;
        materials.set(material.id, material);
      }
    } else if (entry.tool === 'generate_script') {
      const script = result.script;
      if (!script || !materials.has(args.materialId) || script.materialId !== args.materialId) dependenciesValid = false;
      if (script) scripts.set(script.id, script);
    } else if (entry.tool === 'estimate_plan') {
      const estimate = result.estimate; const script = scripts.get(args.scriptId); const material = materials.get(script?.materialId);
      const sum = Array.isArray(estimate?.items) ? estimate.items.reduce((n, item) => n + item.amount, 0) : null;
      const cost = material ? material.licenseCost + material.productionCost : null;
      if (!estimate || !material || estimate.scriptId !== args.scriptId || estimate.materialId !== material.id
          || estimate.total !== cost || sum !== cost || estimate.budgetGap !== Math.max(0, cost - task.input.budget)
          || estimate.durationMinutes !== material.durationMinutes || !Number.isFinite(estimate.availableMinutes)
          || estimate.timeGapMinutes !== Math.max(0, material.durationMinutes - estimate.availableMinutes)
          || estimate.feasible !== (cost <= task.input.budget && material.durationMinutes <= estimate.availableMinutes)) dependenciesValid = false;
      if (estimate) estimates.set(estimate.id, estimate);
    } else if (entry.tool === 'save_plan') {
      const estimate = estimates.get(args.estimateId);
      if (!estimate?.feasible || result.total !== estimate.total || !result.planId) dependenciesValid = false;
      savedId = result.planId;
    } else dependenciesValid = false;
  }
  check('tool_results_and_dependencies', dependenciesValid && savedId, '按工具原始结果重建依赖并复算费用、可行性，失败不能记成成功。');
  const finalEstimate = estimates.get(plan?.estimate?.id);
  const finalScript = scripts.get(plan?.script?.id);
  const finalMaterial = materials.get(plan?.material?.id);
  check('saved_plan_consistency', plan && finalEstimate && finalScript && finalMaterial && savedId === plan.id && isDeepStrictEqual(plan.estimate, finalEstimate)
    && isDeepStrictEqual(plan.script, finalScript) && isDeepStrictEqual(plan.material, finalMaterial)
    && plan.estimate.total <= task.input.budget
    && Date.parse(plan.savedAt) + plan.estimate.durationMinutes * 60000 <= Date.parse(task.input.deadline), '已保存方案必须对应成功的素材、脚本和估算，且保存时满足预算与截止时间。');
  check('successful_artifacts_retained', [...materials.values()].every(m => task?.results?.materials?.some(saved => isDeepStrictEqual(saved, m)))
    && [...scripts.values()].every(s => task?.results?.scripts?.some(saved => isDeepStrictEqual(saved, s))), '改计划或处理失败后仍保留检索和脚本的成功产物。');

  if (name === 'normal') {
    check('direct_premium_path', plan?.material?.tier === 'premium' && plan?.estimate?.total === 12
      && !tools.some(e => e.status !== 'success' || e.arguments?.tier === 'standard'), '正常场景直接完成精选方案，无失败或不必要的轻量替代。');
  }
  if (name === 'budget-replan') {
    const over = trace.findIndex(e => e.tool === 'estimate_plan' && e.status === 'success' && e.result?.estimate?.total === 12
      && e.result.estimate.budgetGap === 2 && e.result.estimate.feasible === false);
    const next = trace[over + 1];
    const alternative = trace.findIndex((e, i) => i > over && e.tool === 'estimate_plan' && e.status === 'success' && e.result?.estimate?.total === 8 && e.result.estimate.feasible);
    check('observed_12_then_changed_action', over >= 0 && next?.tool === 'search_materials' && next.arguments?.tier === 'standard' && next.status === 'success', '必须先实际观察精选估算 12 超过预算 10，再选择轻量素材工具；直接选 8 不算此路径通过。');
    check('reestimated_8_then_saved', alternative > over && over >= 0 && plan?.material?.tier === 'standard' && plan?.estimate?.total === 8
      && trace.slice(alternative + 1).some(e => e.tool === 'save_plan' && e.status === 'success' && e.arguments?.estimateId === trace[alternative].result.estimate.id), '替代方案必须重新估算为 8，再保存该估算对应的方案。');
  }
  if (name === 'tool-failure') {
    const failure = trace.findIndex(e => e.tool === 'generate_script' && e.status === 'failed' && e.arguments?.materialId?.startsWith('premium'));
    const next = trace[failure + 1];
    check('failure_observed_then_alternative', failure >= 0 && task?.injection?.consumed === true && next?.tool === 'search_materials'
      && next.arguments?.tier === 'standard' && next.status === 'success' && plan?.material?.tier === 'standard', '精选脚本工具实际失败后，下一动作选择轻量替代，而非只自动重试同一工具。');
    check('failed_script_not_saved', failure >= 0 && !task?.results?.scripts?.some(s => s.materialId === trace[failure].arguments.materialId), '失败的精选脚本不能被伪记为成功产物。');
  }
  return { case: name, passed: checks.every(c => c.passed), checks, errors: checks.filter(c => !c.passed).map(c => `${c.name}: ${c.detail}`), toolCalls: tools.length, pathSignature: tools.map(e => `${e.tool}:${e.status}:${e.arguments?.tier || ''}`).join(' → ') };
}

export function evaluateLiveSuite(records) {
  const cases = liveCases.map(({ name }) => evaluateLiveCase(name, records?.[name]));
  const distinctPaths = new Set(cases.filter(c => c.passed).map(c => c.pathSignature)).size >= 2;
  const runIds = liveCases.map(({ name }) => records?.[name]?.runId);
  const sameRun = runIds.every(id => typeof id === 'string' && id.length > 0 && id === runIds[0]);
  return { passed: cases.every(c => c.passed) && distinctPaths && sameRun, distinctPaths, sameRun, cases,
    boundary: '验证路径、依赖及运行元数据的一致性；不独立证明服务商真实性或候选人个人贡献。' };
}
