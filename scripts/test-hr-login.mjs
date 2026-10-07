import 'dotenv/config';

async function test() {
  const res = await fetch('http://localhost:4000/api/auth/hr/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'HR001', password: 'Admin@123' })
  });
  const text = await res.text();
  console.log('Status:', res.status);
  console.log('Response:', text);
}

test().catch(console.error);