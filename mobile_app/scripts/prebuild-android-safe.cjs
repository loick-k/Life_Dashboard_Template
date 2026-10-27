// Expo prebuild can automatically DELETE a malformed android/ in non-interactive mode,
// even without --clean. Never invoke that path for an existing native project.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { AndroidConfig } = require('@expo/config-plugins');

async function configureExisting(root, configure) {
  const checks = [
    AndroidConfig.Paths.getAppBuildGradleAsync,
    AndroidConfig.Paths.getProjectBuildGradleAsync,
    AndroidConfig.Paths.getMainApplicationAsync,
    AndroidConfig.Paths.getMainActivityAsync,
  ];
  for (const check of checks) await check(root);
  for (const file of ['app/src/main/AndroidManifest.xml', 'gradlew.bat', 'settings.gradle']) {
    if (!fs.existsSync(path.join(root, 'android', file))) throw new Error('Incomplete Android project. Refusing automatic deletion/regeneration.');
  }
  // Locked Expo 57 API: applies plugins ONLY, no template copying/clearing/installing.
  await configure(root, { platforms: ['android'] });
}
async function main() {
  process.env.EXPO_OFFLINE = '1';
  process.env.EXPO_NO_TELEMETRY = '1';
  const root = fs.realpathSync(path.resolve(__dirname, '..'));
  if (!fs.existsSync(path.join(root, 'android'))) {
    const child = spawnSync(process.execPath, [path.join(root, 'node_modules/expo/bin/cli'), 'prebuild', '--platform', 'android', '--no-install'], { cwd: root, stdio: 'inherit' });
    if (child.status !== 0) throw new Error('Initial Android generation failed.');
    return;
  }
  const cliPackage = require.resolve('@expo/cli/package.json', { paths: [path.dirname(require.resolve('expo/package.json'))] });
  const { configureProjectAsync } = require(path.join(path.dirname(cliPackage), 'build/src/prebuild/configureProjectAsync.js'));
  await configureExisting(root, configureProjectAsync);
  console.log('Android plugins applied without clearing the native project.');
}
module.exports = { configureExisting };
if (require.main === module) main().catch(() => {
  console.error('Safe Android configuration failed. Existing files preserved. Inspect native templates; never retry with --clean automatically.');
  process.exitCode = 1;
});
