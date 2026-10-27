import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { migrate, type BindValue, type Migration } from '../src/storage/migrations.ts';
import { Catalogs, type QueryConnection } from '../src/storage/catalogs.ts';
import { DailyEntries } from '../src/storage/dailyEntries.ts';
import { readRelatedSummary } from '../src/storage/dailySummary.ts';
import { readWeeklyMetrics } from '../src/storage/weeklyMetrics.ts';
import { captureSnapshot, restoreSnapshot } from '../src/storage/backupSnapshot.ts';

const { harness, press } = createRequire(import.meta.url)('./helpers/reactHarness.cjs');
const migrations: Migration[] = JSON.parse(readFileSync('src/storage/generated/migrations.json', 'utf8'));
function fixture() {
  const native = new DatabaseSync(':memory:');
  const sql: QueryConnection = {
    execAsync: async statement => { native.exec(statement); },
    getFirstAsync: async <T>(statement: string, ...params: BindValue[]) => native.prepare(statement).get(...params) as T ?? null,
    getAllAsync: async <T>(statement: string, ...params: BindValue[]) => native.prepare(statement).all(...params) as T[],
    runAsync: async (statement, ...params) => ({ changes: Number(native.prepare(statement).run(...params).changes) }),
  };
  return { native, sql };
}

test('social uncheck/recheck retains identity, source dates, context, duration and note but excludes deselected encounters from Bilan', async () => {
  const { native, sql } = fixture();
  try {
    await migrate(sql, migrations);
    const day = await new DailyEntries(sql, randomUUID).getOrCreate('2026-10-26');
    const people = new Catalogs(sql, randomUUID, 'friends');
    const id = await people.create('Personne synthétique'), first = await people.select(day.entry_id, id);
    native.prepare('UPDATE social_logs SET note = ?, duration_minutes = 90, context = ? WHERE social_log_id = ?').run('Note fictive', 'Téléphone', first.id);
    const before = native.prepare('SELECT * FROM social_logs WHERE social_log_id = ?').get(first.id)!;
    await people.deselect(first);
    await assert.rejects(people.deselect(first));
    assert.equal((await readRelatedSummary(sql, day.entry_id)).social.length, 0);
    const metrics = await readWeeklyMetrics(sql, day.entry_date);
    assert.equal(metrics.find(item => item.key === 'social_count')!.value, 0);
    assert.equal(metrics.find(item => item.key === 'social_minutes')!.value, null);
    const selected = await people.select(day.entry_id, id);
    assert.equal(selected.id, first.id); assert.equal(selected.revision, 3);
    const after = native.prepare('SELECT * FROM social_logs WHERE social_log_id = ?').get(first.id)!;
    for (const field of ['social_log_id', 'created_at', 'note', 'duration_minutes', 'context']) assert.equal(after[field], before[field]);
    assert.equal((await readRelatedSummary(sql, day.entry_id)).social[0]!.duration_minutes, 90);
  } finally { native.close(); }
});

test('deselected social detail survives exact backup/restore and can be selected again', async () => {
  const a = fixture(), b = fixture();
  try {
    await migrate(a.sql, migrations); await migrate(b.sql, migrations);
    const day = await new DailyEntries(a.sql, randomUUID).getOrCreate('2026-10-26');
    const people = new Catalogs(a.sql, randomUUID, 'friends'); const id = await people.create('Personne fictive');
    const log = await people.select(day.entry_id, id);
    a.native.prepare('UPDATE social_logs SET note = ?, duration_minutes = 0 WHERE social_log_id = ?').run('Note avec durée zéro', log.id);
    await people.deselect(log);
    const snapshot = await captureSnapshot(a.sql, migrations);
    await restoreSnapshot(b.sql, JSON.stringify(snapshot), migrations);
    assert.deepEqual((await captureSnapshot(b.sql, migrations)).tables, snapshot.tables);
    assert.equal((await new Catalogs(b.sql, randomUUID, 'friends').select(day.entry_id, id)).id, log.id);
    const restored = b.native.prepare('SELECT note,duration_minutes FROM social_logs WHERE social_log_id = ?').get(log.id)!;
    assert.equal(restored.note, 'Note avec durée zéro'); assert.equal(restored.duration_minutes, 0);
  } finally { a.native.close(); b.native.close(); }
});

test('pre-006 backup upgrades social selection only, refuses injected future flags and preserves existing destination on rejection', async () => {
  const a = fixture(), b = fixture();
  try {
    await migrate(a.sql, migrations.slice(0, 5)); await migrate(b.sql, migrations);
    const day = await new DailyEntries(a.sql, randomUUID).getOrCreate('2026-10-26');
    await a.sql.runAsync('INSERT INTO friends (friend_id,name,created_at,updated_at) VALUES (?,?,?,?)', 'synthetic-person', 'Personne fictive', '2026-10-26', '2026-10-26');
    await a.sql.runAsync('INSERT INTO social_logs (social_log_id,entry_id,friend_id,note,duration_minutes,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', 'synthetic-log', day.entry_id, 'synthetic-person', 'Historique fictif', 30, '2026-10-26', '2026-10-26');
    const snapshot = await captureSnapshot(a.sql, migrations.slice(0, 5));
    await restoreSnapshot(b.sql, JSON.stringify(snapshot), migrations);
    const restored = b.native.prepare('SELECT included,note,duration_minutes FROM social_logs').get()!;
    assert.equal(restored.included, 1); assert.equal(restored.note, 'Historique fictif'); assert.equal(restored.duration_minutes, 30);
    snapshot.tables.social_logs[0]!.included = 0;
    const before = await captureSnapshot(b.sql, migrations);
    await assert.rejects(restoreSnapshot(b.sql, JSON.stringify(snapshot), migrations));
    assert.deepEqual((await captureSnapshot(b.sql, migrations)).tables, before.tables);
  } finally { a.native.close(); b.native.close(); }
});

test('interrupted migration 006 rolls back column/index and journal, preserving encounters for retry', async () => {
  const { native, sql } = fixture();
  try {
    await migrate(sql, migrations.slice(0, 5));
    const interrupted = { ...sql, runAsync: async (statement: string, ...params: BindValue[]) => {
      if (statement.includes('INSERT INTO schema_migrations') && params[0] === '006_social_selection') throw new Error('Synthetic journal interruption');
      return sql.runAsync(statement, ...params);
    } };
    await assert.rejects(migrate(interrupted, migrations));
    assert.equal(native.prepare('PRAGMA table_info(social_logs)').all().some(row => row.name === 'included'), false);
    assert.equal(native.prepare('SELECT count(*) AS n FROM schema_migrations').get()!.n, 5);
    await migrate(sql, migrations); await migrate(sql, migrations);
    assert.equal(native.prepare('SELECT count(*) AS n FROM schema_migrations').get()!.n, 6);
  } finally { native.close(); }
});

test('archiving never changes completion, completing/reopening is explicit, capacity and stale revisions still enforced', async () => {
  const { native, sql } = fixture();
  try {
    await migrate(sql, migrations); const goals = new Catalogs(sql, randomUUID, 'goals');
    const id = await goals.create('Objectif synthétique'); let item = (await goals.list())[0]!;
    await goals.setActive(item, false); item = (await goals.list(false))[0]!;
    assert.equal(item.completed_at, null);
    await goals.setActive(item, true); item = (await goals.list())[0]!;
    await goals.setCompleted(item, true); const completed = (await goals.list(false))[0]!;
    assert.ok(completed.completed_at); assert.equal(completed.active, 0);
    await goals.setActive(completed, false); item = (await goals.list(false))[0]!;
    assert.equal(item.completed_at, completed.completed_at);
    await assert.rejects(goals.setActive(item, true)); await assert.rejects(goals.setCompleted(completed, false));
    await goals.create('Autre A'); await goals.create('Autre B'); await goals.create('Autre C');
    await assert.rejects(goals.setCompleted(item, false));
    await goals.setActive((await goals.list())[0]!, false); await goals.setCompleted(item, false);
    const reopened = (await goals.list()).find(row => row.id === id)!;
    assert.equal(reopened.completed_at, null); assert.equal(reopened.active, 1);
  } finally { native.close(); }
});

test('real social checkbox round trip keeps imported notes and goal archive is distinct from completion', async () => {
  const { native, sql } = fixture(); const h = harness(sql); let tree: any;
  try {
    await migrate(sql, migrations); const day = await new DailyEntries(sql, randomUUID).getOrCreate('2026-10-26');
    const people = new Catalogs(sql, randomUUID, 'friends'); const id = await people.create('Personne fictive');
    const log = await people.select(day.entry_id, id);
    native.prepare('UPDATE social_logs SET note = ?, duration_minutes = 75 WHERE social_log_id = ?').run('Note importée fictive', log.id);
    const { CatalogForm } = h.load('ui/CatalogForm.tsx');
    await h.act(async () => { tree = h.create(h.React.createElement(CatalogForm, { database: sql, entryId: day.entry_id, kind: 'friends' })); });
    await press(h, tree, '☑ Personne fictive'); await press(h, tree, '☐ Personne fictive');
    assert.equal(native.prepare('SELECT note FROM social_logs WHERE social_log_id = ?').get(log.id)!.note, 'Note importée fictive');
    const goals = new Catalogs(sql, randomUUID, 'goals'); const goal = await goals.create('Objectif fictif');
    await h.act(async () => tree.update(h.React.createElement(CatalogForm, { key: 'goals', database: sql, entryId: day.entry_id, kind: 'goals' })));
    await press(h, tree, 'Archiver');
    await h.act(async () => h.alerts.at(-1).buttons.find((button: any) => button.text === 'Confirmer').onPress());
    assert.equal(native.prepare('SELECT completed_at FROM goals WHERE goal_id = ?').get(goal)!.completed_at, null);
    await press(h, tree, 'Afficher les archives'); await press(h, tree, 'Marquer comme terminé');
    await h.act(async () => h.alerts.at(-1).buttons.find((button: any) => button.text === 'Confirmer').onPress());
    assert.ok(native.prepare('SELECT completed_at FROM goals WHERE goal_id = ?').get(goal)!.completed_at);
  } finally { if (tree) await h.act(async () => tree.unmount()); native.close(); }
});
