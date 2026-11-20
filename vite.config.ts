import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
  // แผนที่ 3 มิติ (three.js) เป็น chunk แยก ~570 KB โหลดเฉพาะแท็บเขตทำความสะอาด
  build: { chunkSizeWarningLimit: 650 },
});
