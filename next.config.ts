import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for the slim multi-stage Docker image.
  output: "standalone",
};

export default nextConfig;
