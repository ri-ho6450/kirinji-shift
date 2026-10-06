import { copyFile, mkdir } from 'node:fs/promises';
await mkdir('public', { recursive: true });
for (const extension of ['html', 'htm']) {
  for (const directory of ['.', 'public', 'dist']) {
    await copyFile('dist/index.html', `${directory}/kirinji_shift_app.${extension}`);
  }
}
