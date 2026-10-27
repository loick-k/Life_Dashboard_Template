import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KeyProtection, ProtectionUnavailable, UnlockGeneration } from '../src/storage/keyProtection.ts';

const key = 'ab'.repeat(32);
function fixture() {
  const state = { policy: null as string | null, plain: key as string | null, protected: null as string | null, deny: false };
  const calls: string[] = [];
  const ports = {
    readPolicy: async () => state.policy,
    writePolicy: async (value: string) => { calls.push(value); state.policy = value; },
    readPlain: async () => { calls.push('readPlain'); return state.plain; },
    writePlain: async (value: string) => { calls.push('writePlain'); state.plain = value; },
    deletePlain: async () => { calls.push('deletePlain'); state.plain = null; },
    readProtected: async () => { calls.push('authenticate'); if (state.deny) throw new Error('Cancelled'); return state.protected; },
    writeProtected: async (value: string) => { calls.push('writeProtected'); state.protected = value; },
    deleteProtected: async () => { state.protected = null; },
    canAuthenticate: () => true,
  };
  return { state, calls, ports, vault: new KeyProtection(ports) };
}
test('enable verifies authenticated copy before removing original; restart authenticates', async () => {
  const { vault, state, calls, ports } = fixture();
  await vault.enable();
  assert.equal(state.plain, null); assert.equal(state.protected, key);
  assert.deepEqual(calls, ['readPlain', 'writeProtected', 'authenticate', 'enabling:v1', 'deletePlain', 'biometric:v1']);
  calls.length = 0;
  assert.equal(await new KeyProtection(ports).readKey(), key);
  assert.deepEqual(calls, ['authenticate', 'deletePlain']);
});
test('cancelled activation leaves original readable and never reports activation', async () => {
  const { vault, state } = fixture(); state.deny = true;
  await assert.rejects(vault.enable(), ProtectionUnavailable);
  assert.equal(state.policy, null); assert.equal(state.plain, key);
});
test('cancelled/invalidated protected key never falls back to old copy or resets it', async () => {
  const { vault, state, calls } = fixture(); state.policy = 'biometric:v1'; state.protected = key; state.deny = true;
  await assert.rejects(vault.readKey(), ProtectionUnavailable);
  state.deny = false; state.protected = null;
  await assert.rejects(vault.readKey(), ProtectionUnavailable);
  assert.equal(state.plain, key); assert.equal(calls.includes('readPlain'), false);
  await assert.rejects(vault.initialize(key), ProtectionUnavailable);
});
test('interrupted enable completes only after authentication; no downgrade on cleanup failure', async () => {
  const { vault, state, ports } = fixture();
  const remove = ports.deletePlain; ports.deletePlain = async () => { throw new Error('Disk failure'); };
  await assert.rejects(vault.enable(), ProtectionUnavailable);
  assert.equal(state.policy, 'enabling:v1');
  state.deny = true; await assert.rejects(new KeyProtection(ports).readKey(), ProtectionUnavailable);
  state.deny = false; ports.deletePlain = remove;
  assert.equal(await new KeyProtection(ports).readKey(), key);
  assert.equal(state.plain, null); assert.equal(state.policy, 'biometric:v1');
});
test('disable needs authentication and persists verified original before switching policy', async () => {
  const { vault, state } = fixture(); await vault.enable(); state.deny = true;
  await assert.rejects(vault.disable(), ProtectionUnavailable); assert.equal(state.plain, null);
  state.deny = false; await vault.disable();
  assert.equal(state.policy, 'device:v1'); assert.equal(state.protected, null);
  assert.equal(await vault.readKey(), key);
});
test('interrupted disable cannot bypass biometrics, corrupted policy and unavailable hardware fail closed', async () => {
  const { vault, state, ports } = fixture(); await vault.enable();
  ports.writePolicy = async () => { throw new Error('Disk failure'); };
  await assert.rejects(vault.disable(), ProtectionUnavailable);
  state.deny = true; await assert.rejects(new KeyProtection(ports).readKey(), ProtectionUnavailable);
  state.policy = 'future:v2'; await assert.rejects(new KeyProtection(ports).readKey(), ProtectionUnavailable);
  state.policy = null; ports.canAuthenticate = () => false;
  await assert.rejects(new KeyProtection(ports).enable(), ProtectionUnavailable);
});
test('single operation; malformed authenticated read-back never deletes original', async () => {
  const { vault, state, ports } = fixture(); ports.readProtected = async () => 'bad';
  const first = vault.enable(); await assert.rejects(vault.readKey(), ProtectionUnavailable);
  await assert.rejects(first, ProtectionUnavailable); assert.equal(state.plain, key); assert.equal(state.policy, null);
});
test('background invalidates an in-flight unlock even after returning active', () => {
  const gate = new UnlockGeneration(); const token = gate.begin();
  assert.equal(gate.accepts(token, true), true);
  assert.equal(gate.accepts(token, false), false);
  gate.invalidate(); assert.equal(gate.accepts(token, true), false);
  assert.equal(gate.accepts(gate.begin(), true), true);
});
