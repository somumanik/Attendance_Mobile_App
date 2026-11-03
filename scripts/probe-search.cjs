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
  const byName = await get('/api/hr/reports/absent-miss/employees?fromDate=2026-10-01&toDate=2026-10-31&search=Anuj+Mishra&pageSize=50&page=1', token);
  console.log('search by name total:', byName.total, 'rows:', byName.rows?.length);
  const byCode = await get('/api/hr/reports/absent-miss/employees?fromDate=2026-10-01&toDate=2026-10-31&search=S00001&pageSize=50&page=1', token);
  console.log('search by code total:', byCode.total, 'rows:', byCode.rows?.length);
  const single = await get('/api/hr/reports/absent-miss/employees?fromDate=2026-10-01&toDate=2026-10-01&search=S00001&pageSize=50&page=1', token);
  console.log('single day (Oct1) total:', single.total, single.rows?.map(r=>r.status));
}
main();