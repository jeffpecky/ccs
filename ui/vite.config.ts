import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

const UI_ROOT = __dirname;

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: '../dist/ui',
    emptyOutDir: true,
    sourcemap: false,
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/recharts/') || id.includes('/node_modules/d3-')) return 'react-vendor';
          if (id.includes('/node_modules/lodash/')) return 'lodash-vendor';
          if (id.includes('/node_modules/@babel/runtime/')) return 'babel-runtime';
          if (/\/node_modules\/(react|react-dom|react-router-dom)\//.test(id))
            return 'react-vendor';
          if (id.includes('/node_modules/@radix-ui/')) return 'radix-ui';
          if (id.includes('/node_modules/@tanstack/')) return 'tanstack';
          if (/\/node_modules\/(i18next|react-i18next)\//.test(id)) return 'react-vendor';
          if (/\/node_modules\/(react-hook-form|@hookform\/resolvers|zod)\//.test(id))
            return 'form-utils';
          if (id.includes('/node_modules/lucide-react/')) return 'icons';
          if (id.includes('/node_modules/prism-react-renderer/')) return 'code-highlight';
          if (id.includes('/node_modules/sonner/')) return 'notifications';
          if (
            /\/node_modules\/(date-fns|clsx|class-variance-authority|tailwind-merge|yaml)\//.test(
              id
            )
          )
            return 'utils';
        },
      },
    },
  },
  server: {
    port: 5173,
    fs: {
      allow: [UI_ROOT],
    },
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
  },
});
