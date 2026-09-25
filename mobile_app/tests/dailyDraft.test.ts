import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DailyDraft } from '../src/storage/dailyDraft.ts';
import { RevisionConflict, type DailyEntry } from '../src/storage/dailyEntries.ts';

const initial: DailyEntry = { entry_id: 'synthetic', entry_date: '2026-09-25', revision: 1, weight_kg: null };

test('rapid edits are ordered, acknowledged before saved, and latest draft stays visible', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const revisions: number[] = [];
  let row = { ...initial };
  const draft = new DailyDraft({ patch: async (id, revision, patch) => {
    revisions.push(revision);
    await gate;
    row = { ...row, ...patch, revision: revision + 1 } as DailyEntry;
    return row;
  } }, initial);
  draft.edit({ weight_kg: 7 });
  draft.edit({ weight_kg: 72.4 });
  draft.edit({ work_start_time: '08:48' });
  assert.equal(draft.status, 'saving');
  assert.equal(draft.snapshot.weight_kg, 72.4);
  const flushed = draft.flush();
  release();
  await flushed;
  assert.equal(draft.status, 'saved');
  assert.deepEqual(revisions, [1, 2, 3]);
  assert.equal(draft.snapshot.work_start_time, '08:48');
});

test('failed write keeps edits and navigation flush rejects until explicit retry', async () => {
  let fail = true;
  let row = { ...initial };
  const draft = new DailyDraft({ patch: async (id, revision, patch) => {
    if (fail) throw new Error('synthetic disk failure');
    row = { ...row, ...patch, revision: revision + 1 } as DailyEntry;
    return row;
  } }, initial);
  draft.edit({ weight_kg: 72.4 });
  await assert.rejects(draft.flush());
  draft.edit({ work_start_time: '08:48' });
  assert.equal(draft.status, 'failed');
  assert.equal(draft.snapshot.weight_kg, 72.4);
  fail = false;
  await draft.retry();
  assert.equal(draft.status, 'saved');
  assert.equal(draft.snapshot.revision, 3);
});

test('retry never silently rebases a stale revision', async () => {
  const revisions: number[] = [];
  const draft = new DailyDraft({ patch: async (id, revision) => {
    revisions.push(revision); throw new RevisionConflict();
  } }, initial);
  draft.edit({ weight_kg: 72.4 });
  await assert.rejects(draft.flush(), RevisionConflict);
  await assert.rejects(draft.retry(), RevisionConflict);
  assert.deepEqual(revisions, [1, 1]);
  assert.equal(draft.snapshot.weight_kg, 72.4);
});
