import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 生产 Docker 镜像用 standalone 产物（.next/standalone + server.js），见 Dockerfile
  output: "standalone",
  distDir: process.env.AGILECAMPUS_DIST_DIR ?? ".next",
  outputFileTracingExcludes: { "/*": ["./.data/**/*", "./.next-*/**/*"] },
};

export default nextConfig;
