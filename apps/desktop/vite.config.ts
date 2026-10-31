import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const root = path.resolve(__dirname, "../..");

export default defineConfig({
  plugins: [react()],
  base: "./",
  clearScreen: false,
  server: {
    port: 5183,
    strictPort: true,
    fs: {
      allow: [root],
    },
  },
  resolve: {
    // Windows 上目录名含 '#' 会让 Rollup 把路径当成 URL 片段；通过盘符映射 + 保留符号链接规整避免 realpath 回真实路径
    preserveSymlinks: true,
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    target: "es2021",
    outDir: "dist",
  },
});
