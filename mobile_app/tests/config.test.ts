import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const { expo } = JSON.parse(readFileSync('app.json', 'utf8'));

test('SQLCipher required and automatic backup disabled', () => {
  assert.equal(expo.plugins.find((p: [string, object]) => p[0] === 'expo-sqlite')[1].useSQLCipher, true);
  assert.equal(expo.android.allowBackup, false);
  assert.ok(expo.android.permissions.includes('android.permission.USE_BIOMETRIC'));
  assert.ok(expo.android.permissions.includes('android.permission.USE_FINGERPRINT'));
  assert.ok(expo.android.blockedPermissions.includes('android.permission.READ_EXTERNAL_STORAGE'));
});

test('only the autonomous Android target is declared', () => {
  assert.deepEqual(expo.platforms, ['android']);
  assert.equal(expo.android.package, 'app.lifedashboard.mobile');
  assert.ok(expo.plugins.includes('./plugins/withLocalRelease.cjs'));
  assert.equal(expo.version, JSON.parse(readFileSync('package.json', 'utf8')).version);
  assert.equal(expo.android.versionCode, 2);
});
