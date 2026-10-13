// Diagnostic: static CSS fetch stability (read-only)
const url = 'http://localhost:3000/_next/static/css/b39e334c4bee1e5c.css';
(async () => {
  for (let i = 0; i < 5; i++) {
    const res = await fetch(url);
    const text = await res.text();
    console.log(`try ${i + 1}: status=${res.status} len=${text.length} hasExecView=${text.includes('.exec-view')} hasFont=${text.includes('Plus Jakarta Sans')}`);
  }
})();