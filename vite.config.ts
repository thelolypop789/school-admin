import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
  // แผนที่ 3 มิติ (three.js) เป็น chunk แยก ~570 KB โหลดเฉพาะแท็บเขตทำความสะอาด
  // s.html = หน้าแอปนักเรียน นศท. (/s) มี manifest/ชื่อ/ไอคอนของตัวเอง
  build: { chunkSizeWarningLimit: 650, rollupOptions: { input: { main: 'index.html', s: 's.html' } } },
});
