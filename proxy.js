// ─── WebSocket-to-Telnet Proxy + Static Server ─────────────────────────
// Bridges browser WebSocket connections to raw TCP (telnet) hosts,
// and serves the frontend over HTTP from the same port.
//
// Usage:  node proxy.js [port]
//         Default port: 8300  (Railway sets PORT automatically)

const http = require('http');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { WebSocketServer } = require('ws');

const PORT = parseInt(process.env.PORT || process.argv[2]) || 8300;

// ── HTTP server: serve index.html ───────────────────────────────────────
const indexPath = path.join(__dirname, 'index.html');

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    fs.readFile(indexPath, (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Error loading index.html');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

// ── WebSocket server: attach to the same HTTP server ────────────────────
const wss = new WebSocketServer({ server });

server.listen(PORT, () => {
  console.log(`POTS Telnet Proxy listening on http://localhost:${PORT}`);
  console.log('Waiting for modem connections...\n');
});

wss.on('connection', (ws, req) => {
  const params = new URL(req.url, `http://localhost:${PORT}`).searchParams;
  const host = params.get('host');
  const port = parseInt(params.get('port')) || 23;

  if (!host) {
    console.log('[DENY] No host specified');
    ws.close(4000, 'No host specified');
    return;
  }

  console.log(`[DIAL] Connecting to ${host}:${port}...`);

  const tcp = net.createConnection({ host, port }, () => {
    console.log(`[CONN] Connected to ${host}:${port}`);
    ws.send(JSON.stringify({ type: 'connected' }));
  });

  // TCP → WebSocket (telnet data → browser)
  tcp.on('data', (data) => {
    if (ws.readyState === 1) {
      ws.send(data);
    }
  });

  tcp.on('end', () => {
    console.log(`[END]  ${host}:${port} closed connection`);
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'disconnected' }));
    }
    ws.close(1000, 'Remote end closed');
  });

  tcp.on('error', (err) => {
    console.log(`[ERR]  ${host}:${port}: ${err.message}`);
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
    ws.close(4001, err.message);
  });

  tcp.on('timeout', () => {
    console.log(`[TIME] ${host}:${port} timed out`);
    tcp.destroy();
  });

  tcp.setTimeout(120000); // 2 minute idle timeout

  // WebSocket → TCP (browser keystrokes → telnet)
  ws.on('message', (data) => {
    if (tcp.writable) {
      tcp.write(data);
    }
  });

  ws.on('close', () => {
    console.log(`[HANG] WebSocket closed, dropping TCP to ${host}:${port}`);
    tcp.destroy();
  });

  ws.on('error', (err) => {
    console.log(`[ERR]  WebSocket error: ${err.message}`);
    tcp.destroy();
  });
});
