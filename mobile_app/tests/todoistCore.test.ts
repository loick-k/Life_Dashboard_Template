import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { migrate, type BindValue } from '../src/storage/migrations.ts';
import type { QueryConnection } from '../src/storage/catalogs.ts';
import { DailyEntries } from '../src/storage/dailyEntries.ts';
import { captureSnapshot, restoreSnapshot } from '../src/storage/backupSnapshot.ts';
import { commandFor } from '../src/integrations/todoistCommands.ts';
import { TodoistClient, type TodoistFetch } from '../src/integrations/todoistClient.ts';
import { TodoistError } from '../src/integrations/todoistTypes.ts';
import { TodoistGateway } from '../src/storage/todoistGateway.ts';
import { TodoistOutbox } from '../src/storage/todoistOutbox.ts';

const migrations = JSON.parse(readFileSync('src/storage/generated/migrations.json', 'utf8'));
const tokenA = 'synthetic-token-account-a', tokenB = 'synthetic-token-account-b';
function adapter(native: DatabaseSync): QueryConnection {
  return {
    execAsync: async statement => { native.exec(statement); },
    getFirstAsync: async <T>(statement: string, ...params: BindValue[]) => native.prepare(statement).get(...params) as T ?? null,
    getAllAsync: async <T>(statement: string, ...params: BindValue[]) => native.prepare(statement).all(...params) as T[],
    runAsync: async (statement, ...params) => ({ changes: Number(native.prepare(statement).run(...params).changes) }),
  };
}
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const task = (id = 'task1', project = 'project1') => ({ id, project_id: project, content: 'Tâche fictive', priority: 3, labels: ['Fictif'], due: { date: '2026-10-26', is_recurring: false }, completed_at: null });
function server() {
  const seen = new Set<string>(), calls: { url: string; options: RequestInit }[] = [], actions: any[] = [];
  let loseAck = false, rejectCommand = false;
  const fetcher: TodoistFetch = async (url, options) => {
    calls.push({ url, options }); const path = new URL(url);
    const authorization = (options.headers as Record<string, string>).Authorization;
    if (path.pathname.endsWith('/user')) return response({ id: authorization === `Bearer ${tokenB}` ? 'ownerB' : 'ownerA', token: 'must-not-be-retained' });
    if (path.pathname.endsWith('/projects')) return response({ results: [{ id: 'project1', name: 'Projet fictif', inbox_project: true }], next_cursor: null });
    if (path.pathname.endsWith('/tasks')) return response({ results: [task()], next_cursor: null });
    assert.ok(path.pathname.endsWith('/sync'));
    const commands = JSON.parse(new URLSearchParams(String(options.body)).get('commands')!); const command = commands[0];
    if (rejectCommand) return response({ sync_status: { [command.uuid]: { http_code: 400, error: `${tokenA} private` } } });
    if (!seen.has(command.uuid)) { seen.add(command.uuid); actions.push(command); }
    if (loseAck) { loseAck = false; throw new Error(`${tokenA} raw network detail`); }
    return response({ sync_status: { [command.uuid]: 'ok' }, temp_id_mapping: command.temp_id ? { [command.temp_id]: 'created1' } : {} });
  };
  return { fetcher, calls, actions, loseAck() { loseAck = true; }, reject() { rejectCommand = true; } };
}
function vault() { let value: string | null = null; return { read: async () => value, write: async (next: string) => { value = next; }, remove: async () => { value = null; } }; }

test('Todoist client uses fixed HTTPS/header auth and bounded, paginated, strictly parsed responses without raw errors', async () => {
  const mock = server(), client = new TodoistClient(tokenA, mock.fetcher);
  assert.equal(await client.userId(), 'ownerA'); assert.equal((await client.projects())[0]!.id, 'project1');
  const page = await client.tasksPage(); assert.equal(page.results[0]!.priority, 3); assert.equal(page.results[0]!.dueDate, '2026-10-26');
  for (const call of mock.calls) { assert.equal(new URL(call.url).origin, 'https://api.todoist.com'); assert.ok(!call.url.includes(tokenA)); assert.equal(call.options.redirect, 'error'); assert.equal(call.options.credentials, 'omit'); }
  assert.equal(JSON.stringify(client), '{}');
  for (const [status, kind] of [[401, 'authentication'], [403, 'forbidden'], [429, 'rate'], [500, 'network']] as const) {
    await assert.rejects(new TodoistClient(tokenA, async () => response({ leaked: tokenA }, status)).tasksPage(), (error: any) => error instanceof TodoistError && error.kind === kind && !error.message.includes(tokenA));
  }
  await assert.rejects(new TodoistClient(tokenA, async () => { throw new Error(tokenA); }).tasksPage(), (error: any) => !String(error).includes(tokenA));
  await assert.rejects(new TodoistClient(tokenA, async () => response({ results: [task('tmp-placeholder')], next_cursor: null })).tasksPage());
});

test('project cursor cycles, malformed/oversized responses, unsafe identifiers and hung requests fail explicitly', async () => {
  let calls = 0, signal: AbortSignal | null | undefined;
  await assert.rejects(new TodoistClient(tokenA, async () => { calls++; return response({ results: [], next_cursor: 'same' }); }).projects()); assert.equal(calls, 2);
  await assert.rejects(new TodoistClient(tokenA, async () => new Response('{bad')).tasksPage());
  await assert.rejects(new TodoistClient(tokenA, async () => new Response('x'.repeat(2000001))).tasksPage());
  await assert.rejects(new TodoistClient(tokenA, async (_, options) => { signal = options.signal; return new Promise(() => {}); }, 15).tasksPage()); assert.equal(signal?.aborted, true);
  assert.throws(() => commandFor({ kind: 'task.close', taskId: '../private' }, randomUUID()));
  assert.throws(() => commandFor({ kind: 'task.add', content: 'Fictif', priority: 9 }, randomUUID(), randomUUID()));
  assert.throws(() => commandFor({ kind: 'task.add', content: 'Fictif', priority: 1, weight_kg: 72 } as any, randomUUID(), randomUUID()));
  const updated = commandFor({ kind: 'task.update', taskId: 'task1', labels: [], dueDate: null }, randomUUID()); assert.deepEqual(updated.args, { id: 'task1', labels: [], due: null });
});

test('uncertain Todoist create survives SQLite reopen and retry uses exactly the same UUID and temp id once', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'life-todoist-synthetic-')); let native = new DatabaseSync(join(folder, 'test.db'));
  const mock = server(), secret = vault();
  try {
    await migrate(adapter(native), migrations); let gateway = new TodoistGateway(adapter(native), secret, mock.fetcher, randomUUID);
    await gateway.configure(tokenA); mock.loseAck();
    await assert.rejects(gateway.perform({ kind: 'task.add', content: 'Tâche fictive durable', priority: 3, projectId: 'project1', dueDate: '2026-10-27' }));
    const pending = (await gateway.outbox.get())!; assert.equal(pending.state, 'prepared'); assert.equal(mock.actions.length, 1);
    assert.ok(!JSON.stringify(native.prepare('SELECT * FROM settings').all()).includes(tokenA));
    native.close(); native = new DatabaseSync(join(folder, 'test.db')); gateway = new TodoistGateway(adapter(native), secret, mock.fetcher, randomUUID);
    await gateway.retry(); assert.equal(mock.actions.length, 1); assert.equal(await gateway.outbox.get(), null);
    const sent = mock.calls.filter(call => call.url.endsWith('/sync')).map(call => JSON.parse(new URLSearchParams(String(call.options.body)).get('commands')!)[0]);
    assert.equal(sent[0].uuid, pending.id); assert.deepEqual(sent[0], sent[1]);
  } finally { native.close(); rmSync(folder, { recursive: true }); }
});

test('outbox exists before external send, is excluded from portable backup and never modifies health data', async () => {
  const native = new DatabaseSync(':memory:'); const sql = adapter(native); const mock = server(), secret = vault();
  try {
    await migrate(sql, migrations); const daily = new DailyEntries(sql, randomUUID); const day = await daily.getOrCreate('2026-10-26');
    await daily.patch(day.entry_id, day.revision, { weight_kg: 72, work_start_time: '08:48', meal_lunch: 'Repas fictif privé' });
    const original = await daily.read(day.entry_id);
    const gateway = new TodoistGateway(sql, secret, async (url, options) => {
      if (url.endsWith('/sync')) { const pending = await new TodoistOutbox(sql, randomUUID).get(); assert.ok(pending); assert.ok(!String(options.body).includes('weight_kg')); assert.ok(!String(options.body).includes('Repas')); }
      return mock.fetcher(url, options);
    }, randomUUID);
    await gateway.configure(tokenA); mock.loseAck(); await assert.rejects(gateway.perform({ kind: 'task.close', taskId: 'task1' }));
    const snapshot = await captureSnapshot(sql, migrations); assert.ok(!JSON.stringify(snapshot).includes('integration.todoist')); assert.ok(!JSON.stringify(snapshot).includes(tokenA));
    const pending = await gateway.outbox.get(); await restoreSnapshot(sql, JSON.stringify(snapshot), migrations); assert.deepEqual(await gateway.outbox.get(), pending);
    await gateway.retry(); assert.deepEqual(await daily.read(day.entry_id), original);
  } finally { native.close(); }
});

test('pending commands cannot cross accounts, token replacement for the same owner works and disconnect never silently abandons', async () => {
  const native = new DatabaseSync(':memory:'); const sql = adapter(native), mock = server(), secret = vault();
  try {
    await migrate(sql, migrations); const gateway = new TodoistGateway(sql, secret, mock.fetcher, randomUUID);
    await gateway.configure(tokenA); mock.loseAck(); await assert.rejects(gateway.perform({ kind: 'task.close', taskId: 'task1' }));
    await assert.rejects(gateway.disconnect()); await assert.rejects(gateway.configure(tokenB));
    const pending = (await gateway.outbox.get())!; await secret.write(JSON.stringify({ version: 1, owner: 'ownerB', token: tokenB }));
    const count = mock.calls.length; await assert.rejects(gateway.retry()); assert.equal(mock.calls.length, count);
    await gateway.configure(tokenA); await gateway.retry(); assert.equal(mock.actions.length, 1);
    await gateway.configure(tokenB); assert.equal((await gateway.status()).account, 'ownerB'); assert.equal(pending.owner, 'ownerA');
    await gateway.disconnect(); assert.equal(await secret.read(), null);
  } finally { native.close(); }
});

test('acknowledged command with failed local cleanup finalizes without another external request; rejected commands are not retried', async () => {
  const native = new DatabaseSync(':memory:'); const sql = adapter(native), mock = server(), secret = vault(); let failCleanup = true;
  try {
    await migrate(sql, migrations);
    const flaky = { ...sql, runAsync: async (statement: string, ...params: BindValue[]) => { if (failCleanup && statement.startsWith('DELETE FROM settings WHERE key=?')) throw new Error('Synthetic cleanup failure'); return sql.runAsync(statement, ...params); } };
    const gateway = new TodoistGateway(flaky, secret, mock.fetcher, randomUUID); await gateway.configure(tokenA);
    await assert.rejects(gateway.perform({ kind: 'project.add', name: 'Projet fictif' })); assert.equal((await gateway.outbox.get())!.state, 'acknowledged');
    const count = mock.calls.length; failCleanup = false; await gateway.retry(); assert.equal(mock.calls.length, count);
    mock.reject(); await assert.rejects(gateway.perform({ kind: 'task.delete', taskId: 'task1' })); assert.equal((await gateway.outbox.get())!.state, 'rejected');
    const rejectedCount = mock.calls.length; await assert.rejects(gateway.retry()); assert.equal(mock.calls.length, rejectedCount);
    await gateway.abandon((await gateway.outbox.get())!.id); assert.equal(await gateway.outbox.get(), null);
  } finally { native.close(); }
});

test('concurrent preparations allow only one pending action and corrupt records are never reset', async () => {
  const native = new DatabaseSync(':memory:'); const sql = adapter(native);
  try {
    await migrate(sql, migrations); const outbox = new TodoistOutbox(sql, randomUUID);
    const prepared = await Promise.allSettled([outbox.prepare('ownerA', { kind: 'task.close', taskId: 'task1' }), outbox.prepare('ownerA', { kind: 'task.delete', taskId: 'task2' })]);
    assert.equal(prepared.filter(item => item.status === 'fulfilled').length, 1);
    await sql.runAsync('UPDATE settings SET value=? WHERE key=?', 'synthetic-corrupt', 'integration.todoist.pending.v1');
    await assert.rejects(outbox.get()); assert.equal(native.prepare('SELECT value FROM settings WHERE key=?').get('integration.todoist.pending.v1')!.value, 'synthetic-corrupt');
  } finally { native.close(); }
});
