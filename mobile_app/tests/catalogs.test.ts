import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Catalogs, type QueryConnection } from '../src/storage/catalogs.ts';
import { DailyEntries, RevisionConflict } from '../src/storage/dailyEntries.ts';
import { migrate, type BindValue } from '../src/storage/migrations.ts';
import { readRelatedSummary } from '../src/storage/dailySummary.ts';
import { SportSessions } from '../src/storage/sportSessions.ts';

test('social selection is idempotent, independent and survives archiving', async () => {
  const sqlite = new DatabaseSync(':memory:');
  const db: QueryConnection = {
    execAsync: async sql => { sqlite.exec(sql); },
    getFirstAsync: async <T>(sql: string, ...params: BindValue[]) => (sqlite.prepare(sql).get(...params) as T) ?? null,
    getAllAsync: async <T>(sql: string, ...params: BindValue[]) => sqlite.prepare(sql).all(...params) as T[],
    runAsync: async (sql, ...params) => ({ changes: Number(sqlite.prepare(sql).run(...params).changes) }),
  };
  try {
    await migrate(db, JSON.parse(readFileSync('src/storage/generated/migrations.json', 'utf8')));
    const day = await new DailyEntries(db, randomUUID).getOrCreate('2026-09-25');
    const people = new Catalogs(db, randomUUID, 'friends');
    const first = await people.create('Personne A', 'Ami'), second = await people.create('Personne B', 'Famille');
    const log = await people.select(day.entry_id, first);
    assert.deepEqual(await people.select(day.entry_id, first), log);
    await people.select(day.entry_id, second);
    await assert.rejects(people.deselect({ ...log, revision: 2 }), RevisionConflict);
    await people.deselect(log);
    assert.equal((await people.logs(day.entry_id)).length, 1);
    const person = (await people.list()).find(item => item.id === second)!;
    await people.setActive(person, false);
    assert.equal((await people.logs(day.entry_id)).length, 1);
    assert.equal((await people.list()).length, 1);
    const goals = new Catalogs(db, randomUUID, 'goals');
    const goal = await goals.create('Objectif fictif A');
    await goals.create('Objectif fictif B'); await goals.create('Objectif fictif C');
    await assert.rejects(goals.create('Quatrième objectif'));
    await goals.select(day.entry_id, goal);
    assert.equal((await goals.logs(day.entry_id))[0]?.worked, 1);
    sqlite.prepare('UPDATE goal_logs SET worked = 0, note = ? WHERE goal_id = ?').run('Note synthétique à préserver', goal);
    const reselected = await goals.select(day.entry_id, goal);
    assert.equal(reselected.worked, 1);
    assert.equal(reselected.revision, 2);
    assert.equal(sqlite.prepare('SELECT note FROM goal_logs WHERE goal_id = ?').get(goal)?.note, 'Note synthétique à préserver');
    await goals.setActive((await goals.list()).find(item => item.id === goal)!, false);
    assert.equal((await goals.logs(day.entry_id)).length, 1);
    assert.equal((await people.logs(day.entry_id)).length, 1);
    const sports = new SportSessions(db, randomUUID);
    await sports.getOrCreate(day.entry_id, 1); // Empty UI slot must not appear as a workout.
    let distanceOnly = await sports.getOrCreate(day.entry_id, 2);
    distanceOnly = await sports.patch(distanceOnly.session_id, distanceOnly.revision, { distance_km: 0 });
    const before = sqlite.prepare('SELECT total_changes() AS count').get()!.count;
    const summary = await readRelatedSummary(db, day.entry_id);
    assert.equal(sqlite.prepare('SELECT total_changes() AS count').get()!.count, before);
    assert.equal(summary.sports.length, 1);
    assert.equal(summary.sports[0]!.distance_km, 0);
    assert.equal(summary.sports[0]!.duration_minutes, null);
    assert.equal(summary.social[0]!.name, 'Personne B');
    assert.equal(summary.social[0]!.category, 'Famille');
    assert.equal(summary.goals[0]!.title, 'Objectif fictif A');
    assert.equal(summary.goals[0]!.note, 'Note synthétique à préserver');
    const other = await new DailyEntries(db, randomUUID).getOrCreate('2026-09-24');
    assert.deepEqual(await readRelatedSummary(db, other.entry_id), { sports: [], social: [], goals: [] });
  } finally { sqlite.close(); }
});
