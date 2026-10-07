// Permanent npm-run-server launcher: PORT (default API_PORT/4000) par pehle se
// LISTEN kar raha purana node process auto-free karke hi server start hota hai.
// Isse "EADDRINUSE: address already in use :::4000" dobara nahi aata.
// Usage: npm run server  (direct bina wrapper: npm run server:direct)
import { execSync, spawn } from 'node:child_process';
import net from 'node:net';

const port = Number(process.env.API_PORT || 4000);

function isPortFree(p) {
  // Express app.listen(port) binds '::' (IPv6-any, dual-stack). Sirf 0.0.0.0 check
  // karne par Windows par tester galti se "free" report karta hai — isliye dono
  // stacks test karo: unspecified host (:: dual) + explicit IPv4.
  const tryBind = (host) => new Promise((resolve) => {
    const opts = host ? { port: p, host } : { port: p };
    const tester = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => tester.once('close', () => resolve(true)).close())
      .listen(opts);
  });
  return (async () => (await tryBind()) && (await tryBind('0.0.0.0')) && (await tryBind('::')))();
}

function pidsListeningOnPort(p) {
  try {
    const out = execSync(
      `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${p} -ErrorAction SilentlyContinue | Where-Object { $_.State -eq 'Listen' } | Select-Object -ExpandProperty OwningProcess -Unique"`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return out.split(/[\r\n]+/).map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
  } catch { return []; }
}

function freePort(p) {
  const pids = pidsListeningOnPort(p).filter((pid) => pid !== process.pid);
  for (const pid of pids) {
    try {
      // Sirf node.exe processes ko touch karo — system/anjaan PID kabhi kill mat karo.
      const name = execSync(
        `powershell -NoProfile -Command "(Get-Process -Id ${pid} -ErrorAction Stop).ProcessName"`,
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      ).trim().toLowerCase();
      if (name !== 'node') { console.log(`Port ${p}: PID ${pid} (${name}) skip — sirf node processes free hote hain.`); continue; }
      execSync(`powershell -NoProfile -Command "Stop-Process -Id ${pid} -Force"`, { stdio: 'ignore' });
      console.log(`Port ${p}: purana node server (PID ${pid}) stop kar diya.`);
    } catch { /* already exited ya access nahi — aage badho */ }
  }
}

let free = await isPortFree(port);
if (!free) {
  freePort(port);
  for (let i = 0; i < 10 && !(free = await isPortFree(port)); i++) {
    await new Promise((r) => setTimeout(r, 500));
  }
}
if (!free) {
  console.error(`Port ${port} abhi bhi busy hai. Khud free karke retry karo:`);
  console.error(`  Get-Process node | Stop-Process -Force`);
  console.error(`  npm run server`);
  process.exit(1);
}

const child = spawn(process.execPath, ['server/index.js'], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
