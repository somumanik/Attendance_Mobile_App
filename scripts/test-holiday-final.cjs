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
      
      // Test POST /hr/holidays
      const postData = JSON.stringify({ holidaydate: '2027-09-15', holidayname: 'Test', category: 'Factory Staff', categoryIds: [1, 2] });
      const postReq = http.request({
        hostname: 'localhost',
        port: 4000,
        path: '/api/hr/holidays',
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'Authorization': `Bearer ${token}`,
          'Content-Length': Buffer.byteLength(postData)
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          console.log('POST Status:', res.statusCode);
          console.log('Response:', data);
        });
      });
      postReq.on('error', e => console.error('Post error:', e.message));
      postReq.write(postData);
      postReq.end();
    });
  });
  loginReq.on('error', e => console.error('Login error:', e.message));
  loginReq.write(loginData);
  loginReq.end();
}

test().catch(console.error);