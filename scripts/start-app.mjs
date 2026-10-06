import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { format } from 'node:util';
import { createHash } from 'node:crypto';
import { readFile, writeFile, access, realpath, mkdir, rm, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const identityPath = '/__kirinji_launcher__';

let logging = false;
function initializeLog(root) {
  let filename = path.join(root, 'startup.log');
  const header = `\n[${new Date().toISOString()}] Kirinji launcher PID ${process.pid}\nNode.js ${process.versions.node}; ${process.platform} ${process.arch}\n`;
  try { appendFileSync(filename, header, 'utf8'); }
  catch {
    filename = path.join(tmpdir(), `kirinji-startup-${Date.now()}.log`);
    appendFileSync(filename, header, 'utf8');
  }
  for (const name of ['log', 'error', 'warn']) {
    const original = console[name].bind(console);
    console[name] = (...args) => {
      original(...args);
      try { appendFileSync(filename, format(...args) + '\n', 'utf8'); } catch { /* Console output still works. */ }
    };
  }
  logging = filename;
  console.log(`起動の記録：${filename}`);
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['inherit', 'pipe', 'pipe'], windowsHide: true });
    const relay = (output, stream) => {
      output.on('data', chunk => {
        stream.write(chunk);
        if (logging) { try { appendFileSync(logging, chunk); } catch { /* Preserve console output. */ } }
      });
    };
    relay(child.stdout, process.stdout);
    relay(child.stderr, process.stderr);
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`準備に失敗しました（終了コード ${code}）。インターネット接続を確認して、もう一度起動してください。`)));
  });
}

export async function prepareDependencies(root) {
  if (Number(process.versions.node.split('.')[0]) < 22) {
    throw new Error('Node.js が古いバージョンです。https://nodejs.org/ja から LTS 版をインストールしてください。');
  }
  const fingerprint = createHash('sha256')
    .update(await readFile(path.join(root, 'package.json')))
    .update(await readFile(path.join(root, 'package-lock.json')))
    .update(`${process.versions.node.split('.')[0]}:${process.platform}:${process.arch}`)
    .digest('hex');
  const marker = path.join(root, 'node_modules', '.kirinji-launcher-install');
  try {
    await access(path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'));
    if ((await readFile(marker, 'utf8')).trim() === fingerprint) return;
  } catch { /* First launch or missing dependencies: install using the lockfile. */ }
  console.log('初回の準備中です。必要なプログラムをインストールします（数分かかることがあります）。');
  if (process.platform === 'win32') {
    await run('cmd.exe', ['/d', '/s', '/c', 'npm ci --no-audit --no-fund'], root);
  } else {
    await run('npm', ['ci', '--no-audit', '--no-fund'], root);
  }
  await writeFile(marker, fingerprint + '\n');
}

async function prepareStandalone(root) {
  const hash = createHash('sha256');
  const addDirectory = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) await addDirectory(filename);
      else { hash.update(path.relative(root, filename)); hash.update(await readFile(filename)); }
    }
  };
  await addDirectory(path.join(root, 'src'));
  for (const filename of ['index.html', 'vite.config.ts', 'firebase-applet-config.json', 'package.json', 'package-lock.json', 'scripts/export-standalone.mjs']) {
    hash.update(await readFile(path.join(root, filename)));
  }
  // Environment settings can change generated Firebase configuration. Observe file metadata only.
  for (const filename of ['.env', '.env.local', '.env.production', '.env.production.local']) {
    try { hash.update(`${filename}:${(await stat(path.join(root, filename))).mtimeMs}`); } catch { /* Optional file. */ }
  }
  const fingerprint = hash.digest('hex');
  const marker = path.join(root, 'node_modules', '.kirinji-launcher-build');
  try {
    await access(path.join(root, 'public', 'kirinji_shift_app.html'));
    await access(path.join(root, 'public', 'kirinji_shift_app.htm'));
    if ((await readFile(marker, 'utf8')).trim() === fingerprint) return;
  } catch { /* First launch or changed source: refresh downloadable HTML. */ }
  console.log('アプリを準備しています。ダウンロード用HTMLを生成します…');
  if (process.platform === 'win32') await run('cmd.exe', ['/d', '/s', '/c', 'npm run build'], root);
  else await run('npm', ['run', 'build'], root);
  await writeFile(marker, fingerprint + '\n');
}

export async function openBrowser(url) {
  const execute = (command, args, env = process.env) => new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', windowsHide: true, env });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} の終了コード：${code}`)));
  });
  if (process.platform === 'win32') {
    try {
      // Explicitly show the associated browser; keep only the helper console hidden.
      await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        'try { Start-Process -FilePath $env:KIRINJI_APP_URL -WindowStyle Normal -ErrorAction Stop; exit 0 } catch { exit 1 }'],
        { ...process.env, KIRINJI_APP_URL: url });
    } catch (error) {
      console.warn('標準ブラウザ起動を再試行します：' + error.message);
      await execute('cmd.exe', ['/d', '/s', '/c', `start "" "${url}"`]);
    }
  } else if (process.platform === 'darwin') {
    await execute('open', [url]);
  } else {
    await execute('xdg-open', [url]);
  }
}

async function startUnlocked({ root = defaultRoot, port = 3000, browser = true } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('ポート番号が正しくありません。');
  root = await realpath(root);
  const folderId = createHash('sha256').update(root).digest('hex');
  // Keep the same browser origin as the original manual-start instructions.
  const url = `http://localhost:${port}`;
  const probeURL = `http://127.0.0.1:${port}`;
  let reused = false;
  try {
    const response = await fetch(probeURL + identityPath, { signal: AbortSignal.timeout(1500) });
    const data = await response.json();
    reused = data.app === 'kirinji-shift' && data.folderId === folderId;
  } catch { /* No matching launcher is running. Vite checks port ownership below. */ }

  let server;
  if (!reused) {
    await prepareDependencies(root);
    await prepareStandalone(root);
    console.log('アプリのサーバーを起動しています…');
    const { createServer } = await import('vite');
    server = await createServer({
      root,
      server: { host: '127.0.0.1', port, strictPort: true, open: false },
      plugins: [{
        name: 'kirinji-launcher-identity',
        configureServer(vite) {
          vite.middlewares.use((request, response, next) => {
            if (request.url !== identityPath) return next();
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify({ app: 'kirinji-shift', folderId }));
          });
        },
      }],
    });
    try {
      await server.listen();
      const response = await fetch(probeURL, { signal: AbortSignal.timeout(10000) });
      const html = await response.text();
      if (!response.ok || !html.includes('キリンジ シフト・作業割当')) throw new Error('起動確認に失敗しました。');
    } catch (error) {
      await server.close();
      throw error;
    }
  }
  console.log(reused ? '起動済みのアプリを開きます。' : 'アプリを起動しました。この画面を閉じるとアプリも終了します。');
  console.log(`[kirinji] READY ${url}`);
  if (browser) {
    try { await openBrowser(url); }
    catch (error) {
      console.error('ブラウザの自動起動に失敗しました：' + error.message);
      console.log(`ブラウザで ${url} を開いてください。`);
    }
  }
  return { server, url, reused };
}

// Serialize initial installation/startup so repeated double-clicks cannot run npm ci together.
export async function startApp(options = {}) {
  const root = await realpath(options.root || defaultRoot);
  const folder = path.join(root, '.kirinji-launcher');
  const lock = path.join(folder, 'startup.lock');
  await mkdir(folder, { recursive: true });
  const deadline = Date.now() + 600000;
  let announced = false;
  for (;;) {
    try {
      await mkdir(lock);
      await writeFile(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid }));
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const { pid } = JSON.parse(await readFile(path.join(lock, 'owner.json'), 'utf8'));
        try { process.kill(pid, 0); }
        catch (probe) {
          if (probe.code === 'ESRCH') { await rm(lock, { recursive: true, force: true }); continue; }
        }
      } catch {
        // A crash between creating the directory and writing its owner is recoverable.
        try {
          if (Date.now() - (await stat(lock)).mtimeMs > 60000) { await rm(lock, { recursive: true, force: true }); continue; }
        } catch { continue; }
      }
      if (Date.now() > deadline) throw new Error('別の起動処理が実行中です。準備画面を確認して、完了後にもう一度起動してください。');
      if (!announced) { console.log('別の起動処理の完了を待っています…'); announced = true; }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  try { return await startUnlocked({ ...options, root }); }
  finally { await rm(lock, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const portFlag = process.argv.indexOf('--port');
  try {
    initializeLog(defaultRoot);
    const result = await startApp({
      port: portFlag === -1 ? 3000 : Number(process.argv[portFlag + 1]),
      browser: !process.argv.includes('--no-browser'),
    });
    if (result.server) {
      let stopping = false;
      const stop = async () => {
        if (stopping) return;
        stopping = true;
        const shutdownTimeout = setTimeout(() => process.exit(0), 5000);
        shutdownTimeout.unref();
        result.server.httpServer?.closeAllConnections();
        await result.server.close();
        clearTimeout(shutdownTimeout);
        process.exit(0);
      };
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
    }
  } catch (error) {
    console.error('\n起動できませんでした：' + error.message);
    console.error('ZIPをすべて展開しているか確認してください。すでに黒い起動画面が開いている場合は、閉じてからもう一度お試しください。');
    console.error(`起動の記録：${logging || 'startup.log'}`);
    process.exit(1);
    process.exitCode = 1;
  }
}
