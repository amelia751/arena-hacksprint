import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@daytonaio/sdk", "@aws-sdk/client-s3"],
  agentRules: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Origin-Agent-Cluster", value: "?1" },
        ],
      },
    ];
  },
};

export default nextConfig;
