import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSecureOpener, StorageUnavailable } from '../src/storage/secureOpening.ts';

function fixture() {
  const calls: string[] = [];
  let key: string | null = null;
  const ports = {
    exists: async () => false,
    readKey: async () => key,
    writeKey: async (value: string) => { calls.push('key'); key = value; },
    randomKey: async () => 'ab'.repeat(32),
    open: async () => { calls.push('open'); return { id: 1 }; },
    unlockAndCheck: async () => { calls.push('check'); },
    close: async () => { calls.push('close'); },
  };
  return { ports, calls };
}

test('parallel launches store one key before one database open', async () => {
  const { ports, calls } = fixture();
  const open = createSecureOpener(ports);
  const [a, b] = await Promise.all([open(), open()]);
  assert.equal(a, b);
  assert.deepEqual(calls, ['key', 'open', 'check']);
});

test('existing database without key is never opened or overwritten', async () => {
  const { ports, calls } = fixture();
  ports.exists = async () => true;
  await assert.rejects(createSecureOpener(ports)(), StorageUnavailable);
  assert.deepEqual(calls, []);
});

test('failed key persistence cannot create a database', async () => {
  const { ports, calls } = fixture();
  ports.writeKey = async () => { throw new Error('native secret details'); };
  await assert.rejects(createSecureOpener(ports)(), error => error instanceof StorageUnavailable && !error.message.includes('native'));
  assert.deepEqual(calls, []);
});

test('failed unlock closes the handle, keeps key and permits retry', async () => {
  const { ports, calls } = fixture();
  ports.unlockAndCheck = async () => { throw new Error('wrong key'); };
  const open = createSecureOpener(ports);
  await assert.rejects(open(), StorageUnavailable);
  ports.unlockAndCheck = async () => { calls.push('check'); };
  await open();
  assert.deepEqual(calls, ['key', 'open', 'close', 'open', 'check']);
});

test('malformed persisted key is rejected before interpolating SQL', async () => {
  const { ports, calls } = fixture();
  ports.readKey = async () => "'; DROP TABLE daily_entries;";
  await assert.rejects(createSecureOpener(ports)(), StorageUnavailable);
  assert.deepEqual(calls, []);
});
