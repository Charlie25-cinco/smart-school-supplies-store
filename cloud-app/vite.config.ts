import { defineConfig } from 'vite';
export default defineConfig({ base: '/staff/', build: { outDir: 'dist/staff', emptyOutDir: true }, server: { port: 5174, strictPort: true } });
