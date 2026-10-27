const { withAndroidManifest, withAppBuildGradle, withMainActivity } = require('@expo/config-plugins');

const gradleHook = "apply from: new File(rootDir, '../scripts/android-release-signing.gradle')";
function patchGradle(source) {
  if (source.includes(gradleHook)) return source;
  const release = /(release\s*\{\s*)(?:\/\/[^\n]*\n\s*)*signingConfig signingConfigs\.debug/;
  if (!release.test(source)) throw new Error('Unknown release signing template; refusing debug-key fallback.');
  return source.replace(release, '$1// Signature supplied exclusively by the local release hook.') + '\n' + gradleHook + '\n';
}
function patchActivity(source) {
  const marker = '// life-dashboard: prevent screenshots and recent-task previews';
  if (source.includes(marker)) return source;
  const anchor = 'super.onCreate(null)';
  if (source.split(anchor).length !== 2) throw new Error('Unknown MainActivity template; secure window not applied.');
  return source.replace(anchor, `${marker}\n    window.addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE)\n    ${anchor}`);
}
function protectManifest(manifest) {
  const applications = manifest.manifest.application;
  if (!applications || applications.length !== 1) throw new Error('Expected one Android application.');
  applications[0].$['android:allowBackup'] = 'false';
  applications[0].$['android:usesCleartextTraffic'] = 'false';
  return manifest;
}
module.exports = function withLocalRelease(config) {
  config = withAndroidManifest(config, mod => { mod.modResults = protectManifest(mod.modResults); return mod; });
  config = withMainActivity(config, mod => {
    if (mod.modResults.language !== 'kt') throw new Error('Kotlin MainActivity required.');
    mod.modResults.contents = patchActivity(mod.modResults.contents); return mod;
  });
  return withAppBuildGradle(config, mod => {
    if (mod.modResults.language !== 'groovy') throw new Error('Groovy Android build required.');
    mod.modResults.contents = patchGradle(mod.modResults.contents); return mod;
  });
};
Object.assign(module.exports, { patchGradle, patchActivity, protectManifest });
