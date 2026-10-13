const http = require('http');

function test() {
  const loginData = JSON.stringify({ username: 'HR001', password: 'Admin@123' });
  const loginReq = http.request({
    hostname: 'localhost',
    port: 4000,
    path: '/api/auth/hr/login',
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json', 
      'Content-Length': Buffer.byteLength(JSON.stringify({ username: 'HR001', password: 'Admin@123' })) 
    }
  }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      console.log('Login status:', res.statusCode);
      try {
        const json = JSON.parse(data);
        const token = json.token;
        console.log('Token:', token ? 'ok' : 'failed');
        
        if (!token) {
          console.log('Login failed, no token');
          return;
        }
        
        // Decode token payload
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
        console.log('Token payload:', JSON.stringify(payload, null, 2));
      } catch (e) {
        console.error('Parse error:', e.message);
      }
    });
    loginReq.on('error', e => console.error('Login error:', e.message));
    loginReq.write(JSON.stringify({ username: 'HR001', password: 'Admin@123' }));
    loginReq.end();
  }

test();