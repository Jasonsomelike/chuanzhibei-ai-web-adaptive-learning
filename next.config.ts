import type { NextConfig } from "next";

const config: NextConfig = {
  agentRules: false,
  // 显式指定 Turbopack root，否则它会向上找到用户主目录的 lockfile
  turbopack: { root: import.meta.dirname },

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
