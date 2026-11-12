import type { NextConfig } from "next";

const config: NextConfig = {
  agentRules: false,
  serverExternalPackages: [
    "pdfjs-dist",
    "@napi-rs/canvas",
    "tesseract.js",
    "tesseract.js-core",
    "@tesseract.js-data/eng",
    "@tesseract.js-data/chi_sim",
  ],
  outputFileTracingIncludes: {
    "/api/documents": [
      "./node_modules/tesseract.js/src/**/*",
      "./node_modules/{bmp-js,idb-keyval,is-url,node-fetch,regenerator-runtime,wasm-feature-detect,zlibjs,whatwg-url,tr46,webidl-conversions}/**/*",
      "./node_modules/tesseract.js-core/**/*",
      "./node_modules/@tesseract.js-data/{eng,chi_sim}/**/*",
      "./node_modules/@napi-rs/canvas*/**/*",
      "./node_modules/pdfjs-dist/legacy/build/**/*",
    ],
  },
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
