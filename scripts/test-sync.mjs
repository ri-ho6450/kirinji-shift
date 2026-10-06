import { spawn } from 'node:child_process';
const child = spawn('firebase', ['emulators:exec', '--only', 'firestore', '--project', 'demo-kirinji', '--config', 'firebase.emulator.json', 'playwright test --project=sync'], {
  stdio: 'inherit',
  env: { ...process.env, KIRINJI_SYNC_TEST: '1', XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME || '/workspace/.config', FIREBASE_EMULATORS_PATH: process.env.FIREBASE_EMULATORS_PATH || '/workspace/.cache/firebase/emulators' },
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
