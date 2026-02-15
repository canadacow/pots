// ─── WebSocket-to-Telnet Proxy ──────────────────────────────────────
// Bridges browser WebSocket connections to raw TCP (telnet) hosts.
//
// Usage:  node proxy.js [port]
//         Default port: 8300
//
// The browser connects:  ws://localhost:8300/?host=HOSTNAME&port=TELNET_PORT
// The proxy opens a raw TCP socket to HOSTNAME:TELNET_PORT and pipes
// data bidirectionally between the WebSocket and the TCP socket.

const { WebSocketServer } = require('ws');
const net = require('net');
const url = require('url');

const LISTEN_PORT = parseInt(process.argv[2]) || 8300;

const wss = new WebSocketServer({ port: LISTEN_PORT });

console.log(`POTS Telnet Proxy listening on ws://localhost:${LISTEN_PORT}`);
console.log('Waiting for modem connections...\n');

wss.on('connection', (ws, req) => {
  const params = new URL(req.url, `http://localhost:${LISTEN_PORT}`).searchParams;
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
      // data comes as Buffer or string from browser
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
