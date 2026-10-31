import fs from 'node:fs';
export const catalog = JSON.parse(fs.readFileSync(new URL('../data/catalog.json', import.meta.url), 'utf8'));
export const toolNames = catalog.tools.map(t => t.name);

export function executeTool(task, action, now = Date.now()) {
  const { tool, arguments: args = {} } = action;
  if (!toolNames.includes(tool)) throw new Error('未知工具');
  if (task.injection?.tool === tool && !task.injection.consumed) {
    task.injection.consumed = true;
    if (task.injection.kind === 'partial') return { ok: true, partial: true, materials: [], summary: '素材服务部分成功，未返回可用授权素材；可尝试轻量素材库。' };
    throw new Error('模拟服务暂时不可用（仅注入一次）');
  }
  if (tool === 'search_materials') {
    if (!['premium', 'standard'].includes(args.tier)) throw new Error('tier 必须为 premium 或 standard');
    const query = task.input.theme.toLowerCase();
    const relevance = m => m.tags.reduce((score, tag) => score + (query.includes(tag.toLowerCase()) ? 1 : 0), 0);
    const materials = catalog.materials.filter(m => m.tier === args.tier).sort((a, b) => relevance(b) - relevance(a));
    task.results.materials = [...new Map([...task.results.materials, ...materials].map(m => [m.id, m])).values()];
    return { ok: true, materials, summary: `找到 ${materials.length} 份${args.tier === 'premium' ? '精选' : '轻量'}合成素材` };
  }
  if (tool === 'generate_script') {
    const material = task.results.materials.find(m => m.id === args.materialId);
    if (!material) throw new Error('依赖缺失：必须先检索到该素材');
    const id = `script-${material.id}`;
    const script = {
      id, materialId: material.id, title: `${task.input.theme}｜把灵感变成下一次出发`,
      format: '9:16 竖屏 · 30 秒', channel: '小红书 / 抖音',
      scenes: [
        { time: '00–05s', title: '用一个问题，打开故事', visual: `${material.description.split('、')[0]}，大字字幕入场。`, narration: `如果给「${task.input.theme}」30 秒，你会从哪里开始？` },
        { time: '05–15s', title: '让细节成为记忆点', visual: '三组细节特写，以节奏切换画面；叠加关键词。', narration: '从一个小小的发现，到值得记录的瞬间。让普通的一天，多一点新鲜。' },
        { time: '15–25s', title: '把灵感变成行动', visual: '主画面与原创文字卡交替，呈现主题亮点。', narration: `这次，用自己的方式体验${task.input.theme}。故事的主角，就是你。` },
        { time: '25–30s', title: '留一个参与的入口', visual: '主题标题定格，出现互动问题与收藏提示。', narration: '你最想记录哪个瞬间？评论区一起分享。' }
      ],
      caption: `生活的灵感，藏在每一次认真观察里。一起开启「${task.input.theme}」，收藏这份小小的出发指南。`,
      hashtags: ['#灵感日常', '#记录生活', `#${task.input.theme.replace(/[\s#]/g, '')}`],
      source: 'template', disclosure: '脚本工具使用原创本地模板；真实模型负责工具选择，不负责脚本文案生成。'
    };
    task.results.scripts = [...task.results.scripts.filter(s => s.id !== id), script];
    return { ok: true, script, summary: `已生成 4 段分镜脚本 · ${script.format}` };
  }
  if (tool === 'estimate_plan') {
    const script = task.results.scripts.find(s => s.id === args.scriptId);
    if (!script) throw new Error('依赖缺失：必须先生成脚本');
    const material = task.results.materials.find(m => m.id === script.materialId);
    const availableMinutes = Math.floor((Date.parse(task.input.deadline) - now) / 60000);
    const total = material.licenseCost + material.productionCost;
    const estimate = {
      id: `estimate-${script.id}`, scriptId: script.id, materialId: material.id,
      items: [{ name: '素材授权', amount: material.licenseCost }, { name: '内容制作', amount: material.productionCost }],
      total, durationMinutes: material.durationMinutes, availableMinutes,
      budgetGap: Math.max(0, total - task.input.budget),
      timeGapMinutes: Math.max(0, material.durationMinutes - availableMinutes),
      feasible: total <= task.input.budget && material.durationMinutes <= availableMinutes,
      evaluatedAt: new Date(now).toISOString()
    };
    task.results.estimates = [...task.results.estimates.filter(e => e.id !== estimate.id), estimate];
    return { ok: true, estimate, summary: `预计 ${total} 单位 / ${material.durationMinutes} 分钟；${estimate.feasible ? '满足预算与截止时间' : `不可行，预算缺口 ${estimate.budgetGap}，时间缺口 ${estimate.timeGapMinutes} 分钟`}` };
  }
  if (tool === 'save_plan') {
    const estimate = task.results.estimates.find(e => e.id === args.estimateId);
    if (!estimate) throw new Error('依赖缺失：必须先估算成本');
    // Validate source data again; model output cannot override the constraints.
    const script = task.results.scripts.find(s => s.id === estimate.scriptId);
    const material = task.results.materials.find(m => m.id === estimate.materialId);
    if (!script || !material || script.materialId !== material.id) throw new Error('方案依赖不一致');
    const total = material.licenseCost + material.productionCost;
    if (total > task.input.budget) throw new Error('预算超限，禁止保存');
    if (now + material.durationMinutes * 60000 > Date.parse(task.input.deadline)) throw new Error('剩余时间不足，禁止保存；请重新估算');
    const plan = { id: `plan-${task.id}`, title: task.input.theme, material, script, estimate: { ...estimate, total }, savedAt: new Date(now).toISOString() };
    task.results.plan = plan;
    return { ok: true, planId: plan.id, total, summary: `方案已保存，预计制作费用 ${total} 模拟单位` };
  }
}
