import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const DEPLOYED = 'https://tw-edf7c6f5a5ca428b807c34c7ebf9321f.ecs.us-east-1.on.aws';

// The deployed server has no CORS middleware (docs/superpowers/specs/
// 2026-08-09-demo-simulator-design.md §3.1), so a browser cannot call it
// directly. This proxy makes the API same-origin in dev. WebSockets are
// exempt from CORS and connect straight to the deployment, so `ws: true`
// here is belt-and-braces for anyone who points WS_URL at the proxy too.
// When the server ships CORSMiddleware this whole block can go.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    proxy: {
      '/api': { target: DEPLOYED, changeOrigin: true, secure: true, ws: true },
    },
  },
});
