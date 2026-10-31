import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Agent, InputError } from './agent.js';
import { Store } from './store.js';
import { catalog } from './tools.js';

const root = path.resolve(fileURLToPath(new URL('../public/', import.meta.url)));
export function createServer({ directory = process.env.DATA_DIR || '.runtime', model, stepDelay = 300 } = {}) {
  const store = new Store(directory);
  for (const task of store.list()) {
    if (['running', 'resuming', 'queued'].includes(task.status)) {
      task.status = 'incomplete'; task.code = 'process_interrupted'; task.reason = '服务重启导致执行中断，已保留成功结果，可继续执行。'; store.put(task);
    }
  }
  const agent = new Agent(store, { model, onStep: () => new Promise(resolve => setTimeout(resolve, stepDelay)) });
  const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); };
  async function body(req) {
    req.setEncoding('utf8');
    let buffer = '';
    for await (const chunk of req) { buffer += chunk; if (Buffer.byteLength(buffer) > 16000) throw new InputError('请求体过大', 413); }
    try { const result = JSON.parse(buffer); if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error(); return result; } catch { throw new InputError('请求必须为 JSON 对象'); }
  }
  function launch(id, resume = false) {
    agent.run(id, { resume }).catch(() => {
      const task = store.get(id); task.status = 'incomplete'; task.code = 'internal_error'; task.reason = '执行意外中断，可检查服务端并续跑。'; store.put(task);
    });
  }
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/config' && req.method === 'GET') return json(res, 200, { mode: agent.model.mode, catalog, modelConfigured: agent.model.mode === 'openai' });
      if (url.pathname === '/api/tasks' && req.method === 'GET') return json(res, 200, { tasks: store.list() });
      if (url.pathname === '/api/tasks' && req.method === 'POST') {
        const { task, reused } = agent.create(await body(req));
        if (!reused && task.status === 'queued') launch(task.id);
        return json(res, reused ? 200 : 202, { task, reused });
      }
      const match = url.pathname.match(/^\/api\/tasks\/([a-f0-9-]+)(\/resume|\/export)?$/);
      if (match) {
        const task = store.get(match[1]);
        if (!task) throw new InputError('任务不存在', 404);
        if (!match[2] && req.method === 'GET') return json(res, 200, { task });
        if (match[2] === '/resume' && req.method === 'POST') {
          if (task.mode !== agent.model.mode) throw new InputError('续跑须使用与原任务相同的模型模式', 409);
          if (task.status === 'incomplete') launch(task.id, true);
          return json(res, 202, { task });
        }
        if (match[2] === '/export' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="content-pilot-${task.id}.json"` });
          return res.end(JSON.stringify(task, null, 2));
        }
      }
      if (url.pathname === '/health' && req.method === 'GET') return json(res, 200, { ok: true });
      if (url.pathname.startsWith('/api/')) throw new InputError('接口不存在', 404);
      if (req.method !== 'GET') throw new InputError('不支持该请求方法', 405);
      const file = path.resolve(root, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
      if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw new InputError('页面不存在', 404);
      const type = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" });
      res.end(fs.readFileSync(file));
    } catch (error) { json(res, error.status || 500, { error: error.status ? error.message : '服务器内部错误' }); }
  });
  return { server, store, agent };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server } = createServer();
  const port = Number(process.env.PORT || 3000);
  server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Content Pilot → http://localhost:${port} · ${process.env.AGENT_MODEL_MODE || 'mock'} mode`));
}
