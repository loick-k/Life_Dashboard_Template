import { object, parseTask, text, todoistId, todoistToken, TodoistError, type TodoistPage, type TodoistProject, type TodoistTask } from './todoistTypes.ts';
import type { TodoistCommand } from './todoistCommands.ts';

export type TodoistFetch = (url: string, options: RequestInit) => Promise<Response>;
const base = 'https://api.todoist.com/api/v1';
const maximum = 2000000;
function cursor(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return text(value, 2048);
}
/** Fixed host/endpoints, bounded responses, no automatic retry, no raw error/cause. */
export class TodoistClient {
  #token: string; #fetch: TodoistFetch; #timeout: number;
  constructor(token: string, fetcher: TodoistFetch, timeoutMs = 10000) {
    this.#token = todoistToken(token); this.#fetch = fetcher;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new TodoistError('configuration'); this.#timeout = timeoutMs;
  }
  private async request(path: string, params: Record<string, string> = {}, commands?: TodoistCommand[]): Promise<unknown> {
    const query = new URLSearchParams(params).toString(), url = base + path + (query ? '?' + query : '');
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    const perform = async () => {
      const response = await this.#fetch(url, { method: commands ? 'POST' : 'GET', signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store',
        headers: { Authorization: `Bearer ${this.#token}`, Accept: 'application/json', ...(commands ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
        ...(commands ? { body: new URLSearchParams({ commands: JSON.stringify(commands) }).toString() } : {}) });
      if (response.redirected || response.url && new URL(response.url).origin !== 'https://api.todoist.com') throw new TodoistError('response');
      if (!response.ok) throw new TodoistError(response.status === 401 ? 'authentication' : response.status === 429 ? 'rate' : response.status === 403 ? 'forbidden' : response.status >= 500 ? 'network' : 'rejected');
      const length = Number(response.headers.get('content-length'));
      if (Number.isFinite(length) && length > maximum * 4) throw new TodoistError('response');
      const raw = await response.text(); if (raw.length > maximum) throw new TodoistError('response');
      try { return raw ? JSON.parse(raw) : null; } catch { throw new TodoistError('response'); }
    };
    try {
      return await Promise.race([perform(), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new TodoistError('network')); }, this.#timeout); })]);
    } catch (issue) { if (issue instanceof TodoistError) throw issue; throw new TodoistError('network'); }
    finally { if (timer) clearTimeout(timer); }
  }
  private page<T>(value: unknown, parse: (value: unknown) => T, property = 'results'): TodoistPage<T> {
    const body = object(value), rows = body[property];
    if (!Array.isArray(rows) || rows.length > 200) throw new TodoistError('response');
    return { results: rows.map(parse), nextCursor: cursor(body.next_cursor) };
  }
  async userId(): Promise<string> { return todoistId(object(await this.request('/user')).id); }
  async projectsPage(next?: string | null) {
    return this.page(await this.request('/projects', { limit: '50', ...(next ? { cursor: cursor(next)! } : {}) }), value => { const row = object(value); return { id: todoistId(row.id), name: text(row.name, 200), inbox: row.inbox_project === true || row.is_inbox_project === true } satisfies TodoistProject; });
  }
  async projects(): Promise<TodoistProject[]> {
    const results: TodoistProject[] = [], seen = new Set<string>(); let next: string | null = null;
    do { const page = await this.projectsPage(next); results.push(...page.results); next = page.nextCursor; if (next && seen.has(next) || results.length > 10000) throw new TodoistError('response'); if (next) seen.add(next); } while (next);
    if (new Set(results.map(item => item.id)).size !== results.length) throw new TodoistError('response'); return results;
  }
  async tasksPage(projectId?: string, next?: string | null): Promise<TodoistPage<TodoistTask>> {
    return this.page(await this.request('/tasks', { limit: '50', ...(projectId ? { project_id: todoistId(projectId) } : {}), ...(next ? { cursor: cursor(next)! } : {}) }), parseTask);
  }
  async completedPage(since: string, until: string, next?: string | null): Promise<TodoistPage<TodoistTask>> {
    for (const date of [since, until]) if (!/^\d{4}-\d{2}-\d{2}T.*Z$/.test(date) || !Number.isFinite(new Date(date).valueOf())) throw new TodoistError('configuration');
    if (since >= until || new Date(until).valueOf() - new Date(since).valueOf() > 89 * 86400000) throw new TodoistError('configuration');
    return this.page(await this.request('/tasks/completed/by_completion_date', { since, until, limit: '50', ...(next ? { cursor: cursor(next)! } : {}) }), parseTask, 'items');
  }
  async send(command: TodoistCommand): Promise<{ id?: string }> {
    const body = object(await this.request('/sync', {}, [command])), statuses = object(body.sync_status), status = statuses[command.uuid];
    if (status !== 'ok') {
      if (status && typeof status === 'object' && Number(object(status).http_code) >= 400 && Number(object(status).http_code) < 500) throw new TodoistError('rejected');
      throw new TodoistError('response');
    }
    const mapping = body.temp_id_mapping === undefined ? {} : object(body.temp_id_mapping);
    return command.temp_id && mapping[command.temp_id] !== undefined ? { id: todoistId(mapping[command.temp_id]) } : {};
  }
}
