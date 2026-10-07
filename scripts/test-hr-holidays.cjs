const http = require('http');

async function test() {
  // Login
  const loginData = JSON.stringify({ username: 'HR001', password: 'Admin@123' });
  const loginReq = http.request({
    hostname: 'localhost',
    port: 4000,
    path: '/api/auth/hr/login',
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json', 
      'Content-Length': Buffer.byteLength(loginData) 
    }
  }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      console.log('Login status:', res.statusCode);
      const json = JSON.parse(data);
      const token = json.token;
      console.log('Token:', token ? 'ok' : 'failed');
      
      if (!token) {
        console.log('Login failed, no token');
        return;
      }
      
      // Test GET /hr/holidays (should work with HR role)
      const getReq = http.request({
        hostname: 'localhost',
        port: 4000,
        path: '/api/hr/holidays',
        method: 'GET',
        headers: { 
          'Authorization': `Bearer ${token}`,
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          console.log('GET /hr/holidays Status:', res.statusCode);
          console.log('GET Response:', data);
        });
      });
      getReq.on('error', e => console.error('Get error:', e.message));
      getReq.end();
    });
  });
  loginReq.on('error', e => console.error('Login error:', e.message));
  loginReq.write(loginData);
  loginReq.end();
}

test().catch(console.error);