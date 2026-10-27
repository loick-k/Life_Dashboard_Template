/* Real React components/hooks and real project modules; only native ports are mocked.
 * This checks interactions, not Android rendering, touch dispatch or Keystore. No bundle/cache written. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const React = require('react');
const renderer = require('react-test-renderer');
const source = path.resolve(__dirname, '../../src');
global.IS_REACT_ACT_ENVIRONMENT = true;

function harness(database, ports = {}) {
  const modules = new Map(), back = [], alerts = [], appListeners = [];
  const appState = { currentState: 'active', addEventListener: (_, handler) => {
    appListeners.push(handler); return { remove: () => appListeners.splice(appListeners.indexOf(handler), 1) };
  } };
  const native = {
    View: 'View', Text: 'Text', TextInput: 'TextInput', Pressable: 'Pressable',
    ScrollView: React.forwardRef((props, ref) => {
      React.useImperativeHandle(ref, () => ({ scrollTo() {} }));
      return React.createElement('ScrollView', props);
    }),
    StyleSheet: { create: value => value }, Keyboard: { dismiss() {} }, AppState: appState,
    BackHandler: { addEventListener: (_, handler) => { back.push(handler); return { remove: () => back.splice(back.indexOf(handler), 1) }; }, exitApp() {} },
    Alert: { alert: (title, message, buttons) => alerts.push({ title, message, buttons }) },
    Linking: { openSettings: async () => {} },
  };
  const nativeFiles = {
    File: class File { static pickFileAsync = async () => ports.pickFile ? ports.pickFile() : { canceled: true }; },
    Directory: class Directory { static pickDirectoryAsync = async () => {
      if (ports.pickDirectory) return ports.pickDirectory();
      throw Object.assign(new Error('Synthetic picker cancellation'), { code: 'ERR_PICKER_CANCELLED' });
    } },
  };
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename).exports;
    const normalized = filename.replaceAll('\\', '/');
    if (normalized.endsWith('storage/nativeDatabase.ts')) return { openLocalDatabase: async () => database };
    if (normalized.endsWith('storage/nativeProtection.ts')) return { keyProtection: {
      mode: async () => 'device', readKey: async () => 'a'.repeat(64),
    }, canUseBiometrics: () => false };
    if (filename.endsWith('.json')) return JSON.parse(fs.readFileSync(filename, 'utf8'));
    const module = { exports: {} }; modules.set(filename, module);
    const requireLocal = id => {
      if (id === 'react-native') return native;
      if (id === 'expo-crypto') return { randomUUID: crypto.randomUUID };
      if (id === 'expo-sqlite') return {};
      if (id === 'expo-file-system') return nativeFiles;
      if (!id.startsWith('.')) return require(id);
      const base = path.resolve(path.dirname(filename), id);
      const target = [base, base + '.ts', base + '.tsx', base + '.json'].find(file => fs.existsSync(file) && fs.statSync(file).isFile());
      if (!target || !target.startsWith(source + path.sep)) throw new Error('Invalid test import: ' + id);
      return load(target);
    };
    const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
    } }).outputText;
    new vm.Script('(function(require,module,exports){' + compiled + '\n})', { filename }).runInThisContext()(requireLocal, module, module.exports);
    return module.exports;
  }
  return {
    React, act: renderer.act, create: renderer.create, alerts,
    load: relative => load(path.join(source, relative)),
    back: async () => { let handled = false; await renderer.act(async () => { for (const handler of [...back].reverse()) if (handler()) { handled = true; break; } }); return handled; },
    appState: async state => { await renderer.act(async () => { appState.currentState = state; appListeners.forEach(handler => handler(state)); }); },
  };
}
function visible(node) {
  for (let item = node; item; item = item.parent) {
    const flatten = style => Array.isArray(style) ? style.flatMap(flatten) : [style];
    if (item.props.accessibilityElementsHidden || flatten(item.props.style).some(style => style?.display === 'none')) return false;
  }
  return true;
}
function label(node) { return typeof node === 'string' ? node : node.children.map(child => typeof child === 'string' ? child : label(child)).join(''); }
function button(tree, text, role) {
  const found = tree.root.findAllByType('Pressable').find(node => visible(node) && label(node) === text && (!role || node.props.accessibilityRole === role));
  if (!found) throw new Error('Missing visible button: ' + text);
  return found;
}
function input(tree, text) {
  const found = tree.root.findAllByType('TextInput').find(node => visible(node) && node.props.accessibilityLabel === text);
  if (!found) throw new Error('Missing visible input: ' + text);
  return found;
}
async function press(h, tree, text, role) {
  const node = button(tree, text, role);
  if (node.props.disabled) throw new Error('Disabled button: ' + text);
  await h.act(async () => { await node.props.onPress(); });
}
module.exports = { harness, visible, label, button, input, press };
