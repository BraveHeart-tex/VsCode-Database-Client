import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  build: {
    outDir: '../extension/dist/webview',
    rolldownOptions: {
      output: {
        entryFileNames: 'main.js',
        assetFileNames: 'main.css',
      },
    },
  },
});
