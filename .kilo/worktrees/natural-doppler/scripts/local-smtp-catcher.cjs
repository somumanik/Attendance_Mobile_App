/**
 * Minimal local SMTP sink used ONLY for verification (no external mail server
 * needed). It speaks just enough SMTP for nodemailer: greeting, EHLO, MAIL FROM,
 * RCPT TO, DATA, QUIT. Received messages are appended to CATCHER_OUT (JSON).
 *
 *   node scripts/local-smtp-catcher.cjs            (listens on 127.0.0.1:2525)
 */
const net = require('net');
const fs = require('fs');

const PORT = Number(process.env.CATCHER_PORT || 2525);
const HOST = process.env.CATCHER_HOST || '127.0.0.1';
const OUT = process.env.CATCHER_OUT || 'smtp-catcher-out.json';

const messages = [];
function flush() {
  try { fs.writeFileSync(OUT, JSON.stringify(messages, null, 2), 'utf8'); } catch (_) { /* ignore */ }
}

const server = net.createServer((socket) => {
  let buffer = '';
  let inData = false;
  let dataLines = [];
  let envelope = { from: '', to: [] };
  socket.setEncoding('utf8');
  socket.write('220 local-verify-smtp ready\r\n');

  socket.on('data', (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf('\r\n')) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (inData) {
        if (line === '.') {
          inData = false;
          messages.push({ from: envelope.from, to: envelope.to.slice(), at: new Date().toISOString(), data: dataLines.join('\r\n') });
          flush();
          dataLines = [];
          envelope = { from: '', to: [] };
          socket.write('250 2.0.0 Ok: queued\r\n');
        } else {
          dataLines.push(line.startsWith('..') ? line.slice(1) : line);
        }
        continue;
      }
      const upper = line.toUpperCase();
      if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
        socket.write('250-localhost\r\n250-8BITMIME\r\n250-SIZE 10485760\r\n250 OK\r\n');
      } else if (upper.startsWith('MAIL FROM')) {
        envelope.from = (line.match(/<([^>]*)>/) || [])[1] || '';
        socket.write('250 2.1.0 Ok\r\n');
      } else if (upper.startsWith('RCPT TO')) {
        envelope.to.push((line.match(/<([^>]*)>/) || [])[1] || '');
        socket.write('250 2.1.5 Ok\r\n');
      } else if (upper.startsWith('DATA')) {
        inData = true;
        socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
      } else if (upper.startsWith('RSET')) {
        dataLines = []; envelope = { from: '', to: [] };
        socket.write('250 2.0.0 Ok\r\n');
      } else if (upper.startsWith('NOOP')) {
        socket.write('250 2.0.0 Ok\r\n');
      } else if (upper.startsWith('QUIT')) {
        socket.write('221 2.0.0 Bye\r\n');
        socket.end();
      } else {
        socket.write('250 2.0.0 Ok\r\n');
      }
    }
  });
  socket.on('error', () => { /* client gone */ });
});

server.listen(PORT, HOST, () => {
  console.log(`[SMTP-CATCHER] listening on ${HOST}:${PORT} -> ${OUT}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
