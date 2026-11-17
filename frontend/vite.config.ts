import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: ['macros']
      }
    })
  ],
  server: {
    port: 5173,
    strictPort: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
      'Cross-Origin-Embedder-Policy': 'unsafe-none'
    },
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        ws: true,
      }
    }
  },
  optimizeDeps: {
    exclude: ['lucide-react']
  },
  define: {
    'process.env': {},
    'process.platform': JSON.stringify('win32'),
    'process.version': JSON.stringify('16.0.0'),
  },
  resolve: {
    alias: {
      path: 'path-browserify',
    },
  },
  build: {
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  }
});
