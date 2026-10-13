import 'node:http';

http.get('http://localhost:4000/api/health', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log('Health:', res.statusCode, data));
}).on('error', e => console.error('Error:', e.message));