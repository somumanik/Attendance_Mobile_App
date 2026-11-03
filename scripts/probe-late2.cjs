const http = require('http');
function get(path, token) {
  return new Promise((resolve) => {
    http.get('http://localhost:4000' + path, { headers: { Authorization: 'Bearer ' + token } }, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve({}); } });
    }).on('error', () => resolve({}));
  });
}
async function main() {
  const loginData = JSON.stringify({ username: 'HR001', password: 'Admin@123' });
  const loginRes = await new Promise((resolve) => {
    const q = http.request({ hostname: 'localhost', port: 4000, path: '/api/auth/hr/login', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(loginData) } }, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d)));
    });
    q.on('error', () => resolve({}));
    q.write(loginData); q.end();
  });
  const token = loginRes.token;
  const j = await get('/api/hr/reports/absent-miss/employees?fromDate=2026-10-01&toDate=2026-10-31&search=S00001&pageSize=200&page=1', token);
  for (const r of (j.rows || [])) {
    if (r.isLate || r.isFinalLate) console.log(r.date, 'isLate', r.isLate, 'isFinalLate', r.isFinalLate, 'lateMin', r.lateMinutes, 'grace', r.graceUsed);
  }
  console.log('total rows', j.total);
}
main();
