import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for the slim multi-stage Docker image.
  output: "standalone",
  experimental: {
    serverActions: {
      // Server Actions default to a 1 MB body, which rejects a real scanned
      // invoice. The ingestion caps in `src/lib/uploads.ts` sit below this,
      // so an oversized file gets an explanatory message, not an opaque 413.
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
