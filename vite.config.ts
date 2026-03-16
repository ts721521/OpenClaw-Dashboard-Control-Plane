import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    outDir: 'static/build',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        task_dashboard: resolve(__dirname, 'frontend/task/index.ts'),
        system_dashboard: resolve(__dirname, 'frontend/system/index.ts')
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name].[ext]'
      }
    }
  }
});
