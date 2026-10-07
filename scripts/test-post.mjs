import 'dotenv/config';

async function test() {
  const BASE = 'http://localhost:4000/api';
  
  const loginRes = await fetch('http://localhost:4000/api/auth/hr/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'HR001', password: 'Admin@123' })
  });
  const loginJson = await loginRes.json();
  const token = loginJson.token;
  console.log('HR token:', token ? 'ok' : 'failed');

  // Test POST /hr/holidays
  const res = await fetch('http://localhost:4000/api/hr/holidays', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ holidaydate: '2027-09-15', holidayname: 'Test', category: 'Factory Staff', categoryIds: [1, 2] })
  });
  
  const text = await res.text();
  console.log('Status:', res.status);
  console.log('Response:', text);
}

test().catch(console.error);