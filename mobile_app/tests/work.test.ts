import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workDuration, workBalance } from '../src/domain/work.ts';

test('three precise slots and daily target', () => {
  const minutes = workDuration({ work_start_time: '08:48', work_morning_end_time: '12:30',
    work_afternoon_start_time: '13:30', work_end_time: '17:30', work_third_start_time: '18:30', work_third_end_time: '19:00' });
  assert.equal(minutes, 492);
  assert.equal(workBalance(minutes), 30);
});
test('partial and missing hours are not confused with zero', () => {
  assert.equal(workDuration({}), null);
  assert.equal(workDuration({ work_start_time: '08:00' }), null);
  assert.equal(workDuration({ work_start_time: '08:00', work_morning_end_time: '12:00', work_afternoon_start_time: '13:00' }), null);
  assert.equal(workBalance(null), null);
  assert.equal(workDuration({ work_start_time: '08:00', work_end_time: '08:00' }), 0);
});
test('overnight and day off retain actual time', () => {
  assert.equal(workDuration({ work_start_time: '23:30', work_end_time: '01:15' }), 105);
  assert.equal(workBalance(105, true), 105);
});
