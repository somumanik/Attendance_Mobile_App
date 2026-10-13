/**
 * PHASE L VERIFICATION - Colourful gradient icon system (UI/icon only)
 * =====================================================================
 * Run from the mobile folder:   node scripts/verify-phase-l.cjs
 *
 * Yeh script sirf CHECKS karta hai, koi app file nahi badalta:
 *   1. har changed file babel-preset-expo se compile hoti hai (syntax)
 *   2. NAV_ICON_GRADIENTS me har tab ka valid 2-stop gradient + tint hai
 *   3. koi tab default par fall back nahi karta
 *   4. GradientIcon ka gradient math sahi hai (mixGradientColor)
 *   5. auth / route / navigation logic jaisa tha waisa hi hai (grep guards)
 */
const path = require('path');
const fs = require('fs');
const babel = require('@babel/core');

const MOBILE = path.resolve(__dirname, '..');
let ok = true;
const pass = (m) => console.log('  PASS  ' + m);
const fail = (m) => { ok = false; console.log('  FAIL  ' + m); };

/** Compile + evaluate an ESM/JSX file with optional module stubs. */
function loadModule(file, stubs, preset) {
  const { code } = babel.transformFileSync(file, {
    presets: preset || [['@babel/preset-env', { targets: { node: 'current' } }]],
    plugins: ['@babel/plugin-transform-modules-commonjs'],
    filename: file,
    babelrc: false,
    configFile: false,
  });
  const module = { exports: {} };
  const req = (id) => (stubs && Object.prototype.hasOwnProperty.call(stubs, id) ? stubs[id] : require(id));
  const fn = new Function('module', 'exports', 'require', '__filename', '__dirname', code);
  fn(module, module.exports, req, file, path.dirname(file));
  return module.exports;
}

const FILES = [
  'src/utils/navigationIcons.js',
  'src/components/GradientIcon.jsx',
  'src/components/index.js',
  'src/navigation/EmployeeNavigator.jsx',
  'src/navigation/HRNavigator.jsx',
];

console.log('\n[1] Syntax compile (babel-preset-expo)');
FILES.forEach((rel) => {
  const file = path.join(MOBILE, rel);
  try {
    babel.transformFileSync(file, { presets: ['babel-preset-expo'], filename: file, babelrc: false, configFile: false });
    pass('compiles: ' + rel);
  } catch (e) {
    fail('compile error in ' + rel + ' -> ' + e.message.split('\n')[0]);
  }
});

console.log('\n[2] NAV_ICON_GRADIENTS registry coverage + valid colours');
const reg = loadModule(path.join(MOBILE, 'src/utils/navigationIcons.js'));
const NAV = reg.NAV_ICON_GRADIENTS || {};
const getNavIcon = reg.getNavIcon;

const EMPLOYEE_TABS = ['Dashboard', 'Attendance', 'Leave', 'Reports', 'BdayAnniversary', 'FullFinal', 'Profile'];
const HR_TABS = ['Dashboard', 'Employees', 'Audit', 'Analytics', 'DailyMaster', 'Celebrations', 'Marriage', 'LeaveMgmt', 'Salary', 'Holidays'];
const HEX = /^#[0-9A-Fa-f]{6}$/;

const verifyKeys = (label, keys) => {
  keys.forEach((k) => {
    const c = NAV[k];
    if (!c) return fail(label + ' tab has no registry entry: ' + k);
    if (!HEX.test(c.from)) fail(label + '.' + k + ' "from" not #RRGGBB: ' + c.from);
    if (!HEX.test(c.to)) fail(label + '.' + k + ' "to" not #RRGGBB: ' + c.to);
    if (!HEX.test(c.tint)) fail(label + '.' + k + ' "tint" not #RRGGBB: ' + c.tint);
    if (c.from === c.to) fail(label + '.' + k + ' from === to (not a gradient)');
  });
  pass(label + ' -> ' + keys.length + ' tabs: valid 2-stop gradient + tint');
};
verifyKeys('Employee', EMPLOYEE_TABS);
verifyKeys('HR Admin', HR_TABS);

console.log('\n[3] No tab falls back to the default identity');
let resolved = 0;
EMPLOYEE_TABS.concat(HR_TABS).forEach((k) => {
  if (Object.prototype.hasOwnProperty.call(NAV, k)) resolved += 1;
  else fail('tab has no explicit registry entry: ' + k);
});
pass(resolved + '/' + (EMPLOYEE_TABS.length + HR_TABS.length) + ' tabs have an explicit registry entry');
if (getNavIcon('__nope__').from === '#2563EB') pass('unknown key returns the safe brand fallback');
else fail('unknown key did not return the safe fallback');

console.log('\n[4] GradientIcon gradient math (mixGradientColor)');
const stub = {
  'react-native': {
    View: 'View',
    StyleSheet: {
      create: (o) => o,
      absoluteFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
      absoluteFillObject: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    },
  },
  '@expo/vector-icons': { Ionicons: 'Ionicons' },
};
const gi = loadModule(path.join(MOBILE, 'src/components/GradientIcon.jsx'), stub, ['babel-preset-expo']);
const mix = gi.mixGradientColor;
if (typeof gi.GradientIcon !== 'function') fail('GradientIcon is not exported as a component'); else pass('GradientIcon exported');
if (mix('#2563EB', '#7C3AED', 0) !== '#2563eb') fail('mix t=0 -> ' + mix('#2563EB', '#7C3AED', 0)); else pass('mix(t=0) = start colour');
if (mix('#2563EB', '#7C3AED', 1) !== '#7c3aed') fail('mix t=1 -> ' + mix('#2563EB', '#7C3AED', 1)); else pass('mix(t=1) = end colour');
if (mix('#000', '#fff', 0.5) !== '#808080') fail('short-hex mix -> ' + mix('#000', '#fff', 0.5)); else pass('short hex handled');
if (!HEX.test(mix('nope', '#7C3AED', 0.3))) fail('invalid colour did not fall back safely'); else pass('invalid colour falls back safely');

console.log('\n[5] Auth / route / navigation logic untouched (grep guards)');
const guard = (rel, patterns) => {
  const src = fs.readFileSync(path.join(MOBILE, rel), 'utf8');
  patterns.forEach((p) => {
    const has = src.indexOf(p.text) >= 0;
    if (p.want && !has) fail(rel + ' is MISSING expected text: ' + p.text);
    else if (!p.want && has) fail(rel + ' still contains removed text: ' + p.text);
    else pass(rel + (p.want ? ' still contains: ' : ' no longer contains: ') + p.text);
  });
};
guard('src/navigation/EmployeeNavigator.jsx', [
  { text: 'name="Dashboard"', want: true },
  { text: 'name="FullFinal"', want: true },
  { text: 'name="BdayAnniversary"', want: true },
  { text: 'mustChangePassword', want: true },
  { text: 'pinSetupRequired', want: true },
  { text: 'ForcedPasswordGate', want: true },
  { text: 'ForcedPinGate', want: true },
  { text: 'TAB_COLORS', want: false },
  { text: 'withAlpha', want: false },
]);
guard('src/navigation/HRNavigator.jsx', [
  { text: 'name="Holidays"', want: true },
  { text: 'name="Salary"', want: true },
  { text: 'name="LeaveMgmt"', want: true },
  { text: 'HREmployeeCredentials', want: true },
  { text: 'TAB_ICON_COLORS', want: false },
]);

console.log('\n=================================================================');
console.log(ok ? 'PHASE L VERIFY: ALL CHECKS PASSED' : 'PHASE L VERIFY: FAILURES ABOVE');
console.log('=================================================================\n');
process.exit(ok ? 0 : 1);

