// Phase I bug-fix runtime verification (temporary-password scenario).
// Reads HR credentials from .env WITHOUT printing them. Never logs secrets.
import 'dotenv/config';

const BASE = 'http://localhost:4000/api';
const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' -> ' + detail : ''}`);
};

async function req(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json };
}

const hrUser = process.env.HR_USERNAME;
const hrPass = process.env.HR_PASSWORD;
if (!hrUser || !hrPass) {
  console.error('HR credentials not configured in .env - cannot run scenario.');
  process.exit(1);
}

const TEST_PAYCODE = process.env.TEST_PAYCODE || '0002';
const TEMP_PW = 'Temp' + Math.random().toString(36).slice(2, 8) + '9a';
const NEW_PW = 'NewPass' + Math.random().toString(36).slice(2, 8) + '1';
const TEST_PIN = '4829';

// 1. HR ADMIN LOGIN
const hrLogin = await req('/auth/hr/login', { method: 'POST', body: { username: hrUser, password: hrPass } });
check('1. HR Admin login', hrLogin.status === 200 && !!hrLogin.json?.token, `HTTP ${hrLogin.status}`);
const HR = hrLogin.json?.token;
if (!HR) process.exit(1);

// 2. HR protected route works
const hrMe = await req('/me', { token: HR });
check('2. HR protected route /me', hrMe.status === 200 && hrMe.json?.role === 'HR', `HTTP ${hrMe.status}`);

// 3. HR sets a TEMPORARY password (mustChange = true) for a real employee
const hrReset = await req('/hr/employee/credentials/password', {
  method: 'POST', token: HR,
  body: { paycode: TEST_PAYCODE, password: TEMP_PW, confirmPassword: TEMP_PW, mustChange: true },
});
check('3. HR sets temporary password (mustChange)', hrReset.status === 200 && hrReset.json?.success === true, `HTTP ${hrReset.status}`);

// 4. Credential state: Password Set / Must change = TRUE
const status = await req('/hr/employee/credentials?paycode=' + encodeURIComponent(TEST_PAYCODE), { token: HR });
const st = status.json || {};
check('4. State: passwordSet + mustChangePassword', status.status === 200 && st.passwordSet === true && st.mustChangePassword === true,
  `passwordSet=${st.passwordSet} pinSet=${st.pinSet} mustChange=${st.mustChangePassword} pinSetupRequired=${st.pinSetupRequired}`);
// Rerun state: when the harness employee already has a PIN, the one-time PIN
// gate is satisfied BY DESIGN (employee-auth.js: "If a PIN is already configured
// the flag is treated as satisfied"). The gate checks below adapt accordingly.
const pinAlreadySet = st.pinSet === true;

// 5. Employee logs in with the TEMPORARY password
const empLogin = await req('/auth/employee/login', { method: 'POST', body: { paycode: TEST_PAYCODE, password: TEMP_PW } });
check('5. Employee login with temporary password', empLogin.status === 200 && !!empLogin.json?.token, `HTTP ${empLogin.status}`);
const EMP = empLogin.json?.token;
if (!EMP) process.exit(1);
check('5b. Login response mustChangePassword=true', empLogin.json?.mustChangePassword === true,
  `mustChangePassword=${empLogin.json?.mustChangePassword} pinSetupRequired=${empLogin.json?.pinSetupRequired}`);

// 6. /me carries the live forced flag
const empMe = await req('/me', { token: EMP });
check('6. /me mustChangePassword=true', empMe.status === 200 && empMe.json?.mustChangePassword === true,
  `mustChange=${empMe.json?.mustChangePassword} pinSetupRequired=${empMe.json?.pinSetupRequired}`);

// 7. Employee data BLOCKED while forced
const blocked = await req('/employee/dashboard', { token: EMP });
check('7. Dashboard blocked before change (403 PASSWORD_CHANGE_REQUIRED)',
  blocked.status === 403 && blocked.json?.code === 'PASSWORD_CHANGE_REQUIRED', `HTTP ${blocked.status} code=${blocked.json?.code}`);

// 8. Change password API (identity from JWT, never from body)
const wrongFirst = await req('/employee/password/change', { method: 'POST', token: EMP, body: { currentPassword: 'wrong-pw-1', newPassword: NEW_PW, confirmPassword: NEW_PW } });
check('8a. Wrong current password rejected', wrongFirst.status >= 400 && wrongFirst.status < 500, `HTTP ${wrongFirst.status} code=${wrongFirst.json?.code}`);

const change = await req('/employee/password/change', { method: 'POST', token: EMP, body: { currentPassword: TEMP_PW, newPassword: NEW_PW, confirmPassword: NEW_PW } });
check('8b. Password change succeeds', change.status === 200 && change.json?.success === true, `HTTP ${change.status}`);
const leak = JSON.stringify(change.json || {});
check('8c. Response leaks no password/hash', !leak.includes(NEW_PW) && !leak.toLowerCase().includes('passwordhash'), '');

// 9. Auth responses never contain password fields
check('9. Login/me responses contain no passwordhash fields',
  !JSON.stringify(empLogin.json || {}).toLowerCase().includes('passwordhash') && !JSON.stringify(empMe.json || {}).toLowerCase().includes('passwordhash'), '');

// 10. /me now mustChangePassword=false
const empMe2 = await req('/me', { token: EMP });
check('10. /me mustChangePassword=false after change', empMe2.json?.mustChangePassword === false, `mustChange=${empMe2.json?.mustChangePassword} pinSetupRequired=${empMe2.json?.pinSetupRequired}`);

// 11. HR requires the one-time PIN setup
const requirePin = await req('/hr/employee/credentials/require-pin-setup', { method: 'POST', token: HR, body: { paycode: TEST_PAYCODE } });
check('11. HR requires PIN setup', requirePin.status === 200 && requirePin.json?.pinSetupRequired === true, `HTTP ${requirePin.status}`);

// 12. /me reflects the forced flag (only meaningful while no PIN exists yet)
const empMe3 = await req('/me', { token: EMP });
check(pinAlreadySet ? '12. /me pinSetupRequired=false (PIN already set - gate satisfied by design)' : '12. /me pinSetupRequired=true',
  pinAlreadySet ? empMe3.json?.pinSetupRequired === false : empMe3.json?.pinSetupRequired === true,
  `pinSetupRequired=${empMe3.json?.pinSetupRequired} pinAlreadySet=${pinAlreadySet}`);

// 13. Dashboard blocked until PIN setup (fresh state) / reachable (PIN exists)
const pinBlocked = await req('/employee/dashboard', { token: EMP });
check(pinAlreadySet ? '13. Dashboard reachable (PIN already configured)' : '13. Dashboard blocked until PIN setup',
  pinAlreadySet ? pinBlocked.status === 200 : (pinBlocked.status === 403 && pinBlocked.json?.code === 'PIN_SETUP_REQUIRED'),
  `HTTP ${pinBlocked.status} code=${pinBlocked.json?.code}`);

// 14. PIN validation
const shortPin = await req('/employee/pin/setup', { method: 'POST', token: EMP, body: { pin: '12', confirmPin: '12' } });
check('14a. Non-4-digit PIN rejected', shortPin.status >= 400 && shortPin.status < 500, `HTTP ${shortPin.status}`);
const mismatchPin = await req('/employee/pin/setup', { method: 'POST', token: EMP, body: { pin: TEST_PIN, confirmPin: '1111' } });
check('14b. Mismatched PIN rejected', mismatchPin.status >= 400 && mismatchPin.status < 500, `HTTP ${mismatchPin.status}`);

// 15. Valid PIN setup succeeds (fresh) / Change PIN round-trip (PIN exists)
if (pinAlreadySet) {
  const NEW_PIN = '9182';
  const wrongCurrent = await req('/employee/pin/change', { method: 'POST', token: EMP, body: { currentPin: '0000', newPin: NEW_PIN, confirmPin: NEW_PIN } });
  check('15. Change PIN rejects wrong current PIN', wrongCurrent.status >= 400 && wrongCurrent.status < 500, `HTTP ${wrongCurrent.status} code=${wrongCurrent.json?.code}`);
  const chg = await req('/employee/pin/change', { method: 'POST', token: EMP, body: { currentPin: TEST_PIN, newPin: NEW_PIN, confirmPin: NEW_PIN } });
  check('15b. Change PIN succeeds (TEST_PIN -> NEW_PIN)', chg.status === 200 && chg.json?.success === true, `HTTP ${chg.status}`);
  const chgBack = await req('/employee/pin/change', { method: 'POST', token: EMP, body: { currentPin: NEW_PIN, newPin: TEST_PIN, confirmPin: TEST_PIN } });
  check('15c. Change PIN back (NEW_PIN -> TEST_PIN) so the harness stays rerun-stable', chgBack.status === 200 && chgBack.json?.success === true, `HTTP ${chgBack.status}`);
} else {
  const pinSetup = await req('/employee/pin/setup', { method: 'POST', token: EMP, body: { pin: TEST_PIN, confirmPin: TEST_PIN } });
  check('15. Valid PIN setup succeeds', pinSetup.status === 200 && pinSetup.json?.success === true, `HTTP ${pinSetup.status}`);
  const pinLeak = JSON.stringify(pinSetup.json || {});
  check('15b. PIN setup response leaks no PIN/hash', !pinLeak.includes(TEST_PIN) && !pinLeak.toLowerCase().includes('pinhash'), '');
}

// 16. Dashboard now accessible
const dash = await req('/employee/dashboard', { token: EMP });
check('16. Dashboard accessible after PIN setup', dash.status === 200, `HTTP ${dash.status}`);

// 17. Wrong PIN login rejected
const wrongPin = await req('/auth/employee/login', { method: 'POST', body: { paycode: TEST_PAYCODE, credential: 'pin', pin: '0000' } });
check('17. Wrong PIN login rejected', wrongPin.status >= 400 && wrongPin.status < 500, `HTTP ${wrongPin.status}`);

// 18. Correct PIN login + password fallback both work
const pinLogin = await req('/auth/employee/login', { method: 'POST', body: { paycode: TEST_PAYCODE, credential: 'pin', pin: TEST_PIN } });
check('18a. Correct PIN login works', pinLogin.status === 200 && !!pinLogin.json?.token, `HTTP ${pinLogin.status}`);
const pwLogin = await req('/auth/employee/login', { method: 'POST', body: { paycode: TEST_PAYCODE, password: NEW_PW } });
check('18b. Password login (fallback) works', pwLogin.status === 200 && !!pwLogin.json?.token, `HTTP ${pwLogin.status}`);
const EMP2 = pwLogin.json?.token || EMP;

// 19. Re-login session clean: both gates clear
const meFinal = await req('/me', { token: EMP2 });
check('19. Re-login: both gates clear', meFinal.json?.mustChangePassword === false && meFinal.json?.pinSetupRequired === false,
  `mustChange=${meFinal.json?.mustChangePassword} pinSetupRequired=${meFinal.json?.pinSetupRequired}`);

// 20. Employee A cannot read Employee B (identity from JWT)
const otherPaycode = TEST_PAYCODE === 'EMP001' ? 'EMP002' : 'EMP001';
const cross = await req('/employee/dashboard?paycode=' + encodeURIComponent(otherPaycode), { token: EMP2 });
const crossBody = JSON.stringify(cross.json || {});
check('20. Employee cannot read another paycode via query', cross.status !== 200 || !crossBody.includes(otherPaycode),
  `HTTP ${cross.status} (identity comes from JWT; query paycode ignored)`);

// 21. Employee token blocked from HR routes
const empToHr = await req('/hr/employee/credentials?paycode=' + encodeURIComponent(TEST_PAYCODE), { token: EMP2 });
check('21. Employee token blocked from HR routes', empToHr.status === 401 || empToHr.status === 403, `HTTP ${empToHr.status}`);

// 22. HR regression: employees list + holiday endpoint
const hrEmployees = await req('/hr/employees?pageSize=3', { token: HR });
check('22a. HR employees list works', hrEmployees.status === 200, `HTTP ${hrEmployees.status}`);
const hrHolidays = await req('/hr/holidays?month=2026-10', { token: HR });
check('22b. HR Holiday Management endpoint works', hrHolidays.status === 200, `HTTP ${hrHolidays.status}`);

// 23. HR force-password-change flag works without changing password
const force = await req('/hr/employee/credentials/force-password-change', { method: 'POST', token: HR, body: { paycode: TEST_PAYCODE } });
check('23. HR force-password-change flag works', force.status === 200 && force.json?.mustChangePassword === true, `HTTP ${force.status}`);
const stillLogin = await req('/auth/employee/login', { method: 'POST', body: { paycode: TEST_PAYCODE, password: NEW_PW } });
check('23b. Password unchanged by force flag', stillLogin.status === 200, `HTTP ${stillLogin.status}`);

// 24. Cleanup: HR clears forced flag (password kept)
const hrResetFinal = await req('/hr/employee/credentials/password', {
  method: 'POST', token: HR,
  body: { paycode: TEST_PAYCODE, password: NEW_PW, confirmPassword: NEW_PW, mustChange: false },
});
check('24. Cleanup: HR clears forced flag', hrResetFinal.status === 200 && hrResetFinal.json?.mustChangePassword === false, `HTTP ${hrResetFinal.status}`);

const failed = results.filter(r => !r.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} checks passed ===`);
if (failed.length) {
  console.log('FAILED:');
  failed.forEach(f => console.log(` - ${f.label} (${f.detail})`));
}
process.exit(failed.length ? 1 : 0);


