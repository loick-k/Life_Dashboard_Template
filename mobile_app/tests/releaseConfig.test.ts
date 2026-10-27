import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { patchGradle, patchActivity, protectManifest } = require('../plugins/withLocalRelease.cjs');
const { configureExisting } = require('../scripts/prebuild-android-safe.cjs');

test('release plugin removes debug signing, survives regeneration and rejects unknown templates', () => {
  const source = `android { buildTypes { debug { signingConfig signingConfigs.debug }
    release {
      // Caution: default template
      signingConfig signingConfigs.debug
      minifyEnabled false
    }
  } }`;
  const patched = patchGradle(source);
  assert.equal((patched.match(/signingConfig signingConfigs.debug/g) ?? []).length, 1);
  assert.ok(patched.includes('android-release-signing.gradle'));
  assert.equal(patchGradle(patched), patched);
  assert.throws(() => patchGradle('unknown signing template'));
  const hook = readFileSync('scripts/android-release-signing.gradle', 'utf8');
  assert.ok(hook.includes('buildTypes.release.signingConfig = null'));
  assert.ok(hook.includes('LIFE_DASHBOARD_SIGNING_FILE'));
  assert.ok(!hook.includes("storePassword 'android'"));
});
test('secure window precedes React render, is idempotent; backup and cleartext remain forbidden', () => {
  const patched = patchActivity('override fun onCreate() {\n super.onCreate(null)\n}');
  assert.ok(patched.indexOf('FLAG_SECURE') < patched.indexOf('super.onCreate(null)'));
  assert.equal(patchActivity(patched), patched);
  assert.throws(() => patchActivity('unknown activity'));
  const manifest = { manifest: { application: [{ $: {} as Record<string, string> }] } };
  protectManifest(manifest);
  assert.equal(manifest.manifest.application[0]!.$['android:allowBackup'], 'false');
  assert.equal(manifest.manifest.application[0]!.$['android:usesCleartextTraffic'], 'false');
});
test('incomplete native directory is never cleared by the safe configurator', async () => {
  const root = mkdtempSync(join(tmpdir(), 'life-dashboard-safe-prebuild-'));
  try {
    mkdirSync(join(root, 'android'));
    writeFileSync(join(root, 'android', 'preserved.apk'), 'synthetic marker');
    let configured = false;
    await assert.rejects(configureExisting(root, async () => { configured = true; }));
    assert.equal(configured, false);
    assert.equal(existsSync(join(root, 'android', 'preserved.apk')), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
