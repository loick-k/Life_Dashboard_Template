import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInput } from '../src/domain/input.ts';
import { parisDate, shiftDate } from '../src/domain/dates.ts';

test('decimal comma, zero, partial input and deletion remain distinct', () => {
  assert.equal(parseInput('72,4', 'number'), 72.4);
  assert.equal(parseInput('0', 'number'), 0);
  for (const raw of ['', '72,', 'NaN', '1e2']) assert.equal(parseInput(raw, 'number'), undefined);
  assert.equal(parseInput('08:', 'time'), undefined);
  assert.equal(parseInput('08:48', 'time'), '08:48');
  assert.equal(parseInput('24:00', 'time'), undefined);
});
test('business dates use Paris and calendar navigation survives DST', () => {
  assert.equal(parisDate(new Date('2026-09-24T23:00:00Z')), '2026-09-25');
  assert.equal(parisDate(new Date('2026-01-01T23:30:00Z')), '2026-01-02');
  assert.equal(shiftDate('2026-03-29', 1), '2026-03-30');
  assert.equal(shiftDate('2026-10-25', -1), '2026-10-24');
});
