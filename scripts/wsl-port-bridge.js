// wsl-port-bridge.js — routes Windows localhost:3000 -> WSL (Ubuntu) :3000
// Dual-stack IPv4 & IPv6 loopback bridge with error resiliency.
const net = require('net');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PORT = 3000;
const LOG_FILE = path.join(__dirname, 'wsl-port-bridge.log');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (err) {
    /* ignore log write errors */
  }
}

process.on('uncaughtException', (err) => {
  log(`Uncaught Exception: ${err.message}`);
});

process.on('unhandledRejection', (reason) => {
  log(`Unhandled Rejection: ${reason}`);
});

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function getWslIp() {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const output = execFileSync('wsl.exe', ['-d', 'Ubuntu', '-e', 'hostname', '-I'], {
        encoding: 'utf8',
        timeout: 10000,
      });
      const ip = output.trim().split(/\s+/)[0];
      if (ip && /^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
        return ip;
      }
      log(`WSL IP parse failed (got "${output.trim()}"), attempt ${attempt}/5`);
    } catch (err) {
      log(`Failed to get WSL IP (attempt ${attempt}/5): ${err.message}`);
    }
    sleepSync(1000);
  }
  log('WARNING: falling back to 127.0.0.1 as WSL target');
  return '127.0.0.1';
}

const wslIp = getWslIp();
log(`Routing Windows localhost:${PORT} -> WSL (${wslIp}:${PORT})`);

function createBridgeServer(host) {
  const server = net.createServer((clientSocket) => {
    let targetSocket;
    try {
      targetSocket = net.connect(PORT, wslIp);
    } catch (err) {
      clientSocket.destroy();
      return;
    }

    clientSocket.pipe(targetSocket);
    targetSocket.pipe(clientSocket);

    clientSocket.on('error', () => {
      try { targetSocket.destroy(); } catch (_) {}
    });
    targetSocket.on('error', () => {
      try { clientSocket.destroy(); } catch (_) {}
    });
    clientSocket.on('close', () => {
      try { targetSocket.destroy(); } catch (_) {}
    });
    targetSocket.on('close', () => {
      try { clientSocket.destroy(); } catch (_) {}
    });
  });

  function listenWithRetry(attemptsLeft) {
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
        log(`Port ${PORT} on ${host} in use, retrying in 2s (${attemptsLeft} left)...`);
        setTimeout(() => listenWithRetry(attemptsLeft - 1), 2000);
      } else if (err.code === 'EADDRNOTAVAIL') {
        log(`Host ${host} not available on this system, skipping.`);
      } else {
        log(`Error on ${host}:${PORT} - ${err.message}`);
      }
    });

    server.listen(PORT, host, () => {
      log(`Server listening on ${host}:${PORT}`);
    });
  }

  listenWithRetry(20);
  return server;
}

// Bind both IPv4 and IPv6 loopback so localhost works in all browsers
createBridgeServer('127.0.0.1');
createBridgeServer('::1');
