import type { NextConfig } from "next";
const staticExport = process.env.STATIC_EXPORT === "true";
const config: NextConfig = {
  ...(staticExport
    ? { output: "export" as const, images: { unoptimized: true } }
    : {}),
  devIndicators: false,
  ...(!staticExport
    ? {
        async rewrites() {
          return [
            {
              source: "/api/:path*",
              destination: `${process.env.API_URL || "http://127.0.0.1:8080"}/api/:path*`,
            },
          ];
        },
      }
    : {}),
};
export default config;
