import type { NextConfig } from "next";

const config: NextConfig = {
  // 显式指定 Turbopack root，否则它会向上找到用户主目录的 lockfile
  turbopack: { root: import.meta.dirname },

  // 画布路由的 bundle 较大（elkjs 单独就 ~465KB gzip），
  // 所以路由级代码分割是硬要求，见 research/06-synthesis.md §2.3
  experimental: {
    optimizePackageImports: ["@xyflow/react"],
  },

  async headers() {
    return [
      {
        // 演示与评审期间允许被嵌入，便于评委直接查看
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default config;
