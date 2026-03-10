import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite 配置
 *
 * 开发时，所有 /api/* 请求会被代理到后端（port 5000），
 * 避免浏览器跨域问题，无需在前端硬编码后端地址。
 */
export default defineConfig({
  plugins: [react()],

  server: {
    port: 5173,       // 前端开发服务器端口
    open: true,       // 启动后自动打开浏览器

    // 反向代理：/api/** → http://localhost:5000/api/**
    proxy: {
      '/api': {
        target:      'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },

  build: {
    outDir: 'dist',   // npm run build 输出目录
  },
});
