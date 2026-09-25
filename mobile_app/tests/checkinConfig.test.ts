import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHECKIN_SECTIONS } from '../src/domain/checkinConfig.ts';
import { dailyRules } from '../src/storage/dailyEntries.ts';

test('all daily input fields appear once in the V1 ordered journey', () => {
  const keys = CHECKIN_SECTIONS.flatMap(section => section.fields.map(field => field.key));
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual([...keys, 'work_mode'].sort(), Object.keys(dailyRules).sort());
  assert.deepEqual(CHECKIN_SECTIONS.map(section => section.id), [
    'sleep', 'alcohol', 'weight', 'fat', 'belly', 'work', 'sport', 'phone', 'nutrition', 'me-time', 'listening', 'social', 'goals', 'summary',
  ]);
});
