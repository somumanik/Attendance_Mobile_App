import 'dotenv/config';

const BASE = `http://localhost:${process.env.API_PORT || 4000}/api`;

async function test() {
  const HR = await (await fetch('http://localhost:4000/api/auth/hr/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.HR_USERNAME, password: process.env.HR_PASSWORD })
  })).json().then(r => r.token);
  
  console.log('HR token:', HR ? 'ok' : 'none');
  
  const res = await fetch('http://localhost:4000/api/hr/holidays', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${HR}` },
    body: JSON.stringify({ holidaydate: '2027-09-15', holidayname: 'Test', category: 'Factory Staff', categoryIds: [1, 2] })
  });
  const text = await res.text();
  console.log('Status:', res.status);
  console.log('Response:', text);
}

test().catch(console.error);