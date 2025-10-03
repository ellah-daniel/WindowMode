import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() { // these headers are needed for WASM multithreading (which spatial-player uses)
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin",
          },
          {
            key: "Cross-Origin-Embedder-Policy",
            value: "require-corp",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
