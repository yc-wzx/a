import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"], // 不扫描 standalone／独立浏览器构建目录中的测试副本
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    fileParallelism: false, // 共享测试库，串行执行避免数据互踩
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
