import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const launcher = fileURLToPath(new URL('../scripts/start-app.mjs', import.meta.url));
async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}
async function close(server) {
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
}
function boot(port) {
  const child = spawn(process.execPath, [launcher, '--no-browser', '--port', String(port)]);
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal, output }));
  });
  return { child, done, output: () => output };
}
async function ready(instance) {
  const deadline = Date.now() + 90000;
  while (!instance.output().includes('[kirinji] READY')) {
    if (instance.child.exitCode !== null) throw new Error(instance.output());
    if (Date.now() > deadline) throw new Error('Launcher not ready: ' + instance.output());
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
async function stop(instance) {
  instance.child.kill('SIGTERM');
  const timeout = setTimeout(() => instance.child.kill('SIGKILL'), 7000);
  try { await instance.done; } finally { clearTimeout(timeout); }
}

test('launcher starts usable app and second launch opens the existing instance', { timeout: 120000 }, async () => {
  const reservation = createServer();
  const port = await listen(reservation);
  await close(reservation);
  const first = boot(port);
  try {
    await ready(first);
    const response = await fetch(`http://127.0.0.1:${port}`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /キリンジ シフト・作業割当/);
    const javascript = await fetch(`http://127.0.0.1:${port}/src/main.tsx`);
    assert.equal(javascript.status, 200);
    assert.match(await javascript.text(), /createRoot/);
    const second = boot(port);
    const result = await second.done;
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /起動済みのアプリを開きます/);
    assert.equal((await fetch(`http://127.0.0.1:${port}`)).status, 200);
  } finally { await stop(first); }
});

test('launcher refuses an occupied port instead of opening another app', { timeout: 30000 }, async () => {
  const otherApp = createServer((_request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ app: 'different-app' }));
  });
  const port = await listen(otherApp);
  try {
    const result = await boot(port).done;
    assert.equal(result.code, 1);
    assert.match(result.output, /already in use/);
    assert.equal((await fetch(`http://127.0.0.1:${port}`)).status, 200);
  } finally { await close(otherApp); }
});
