import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Inside docker-compose the browser talks to the web container, which proxies /api to the api service.
// On a plain `npm run dev` the API is on localhost:4000. One env var covers both.
const apiTarget = process.env.VITE_PROXY_TARGET || 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,            // 0.0.0.0 so the docker/IDE preview can reach it
    port: Number(process.env.WEB_PORT || 5173),
    allowedHosts: true,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
