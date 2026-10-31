import fs from 'node:fs';
import path from 'node:path';

export class Store {
  constructor(directory = '.runtime') {
    this.directory = path.resolve(directory);
    fs.mkdirSync(this.directory, { recursive: true });
    this.tasks = new Map();
    for (const file of fs.readdirSync(this.directory).filter(f => f.endsWith('.json'))) {
      const task = JSON.parse(fs.readFileSync(path.join(this.directory, file), 'utf8'));
      this.tasks.set(task.id, task);
    }
  }
  put(task) {
    // Atomic replacement: readers never observe half-written task state.
    const file = path.join(this.directory, `${task.id}.json`);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(task, null, 2));
    fs.renameSync(`${file}.tmp`, file);
    this.tasks.set(task.id, task);
    return task;
  }
  get(id) { return this.tasks.get(id); }
  list() { return [...this.tasks.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  byKey(key) { return this.list().find(t => t.requestKey === key); }
}
