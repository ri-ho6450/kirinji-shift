import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { readFile } from 'node:fs/promises';
import {defineConfig} from 'vite';
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig(() => {

  return {
    base: './',
    optimizeDeps: { entries: ['index.html'] },
    plugins: [react(), tailwindcss(), viteSingleFile(), {
      name: 'serve-standalone-downloads',
      configureServer(server) {
        server.middlewares.use(async (request, response, next) => {
          const filename = request.url?.split('?')[0];
          if (!filename || !/^\/kirinji_shift_app\.(html|htm)$/.test(filename)) return next();
          try {
            const contents = await readFile(path.join(__dirname, 'public', filename.slice(1)));
            response.setHeader('Content-Type', 'text/html; charset=utf-8');
            response.end(contents);
          } catch {
            response.statusCode = 404;
            response.end('Run npm run build to generate standalone downloads.');
          }
        });
      },
    }],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Set DISABLE_HMR=true only when the host environment requires it.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
