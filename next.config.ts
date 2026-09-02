import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
];

const nextConfig: NextConfig = {
  /**
   * Where the project starts, said explicitly.
   *
   * Turbopack otherwise walks up looking for a lockfile and can settle on a
   * directory above the repository, which changes what it resolves and what
   * it watches. The other five services pin it; so does this one.
   */
  turbopack: {
    root: import.meta.dirname,
  },
  poweredByHeader: false,
  output: "standalone",
  outputFileTracingRoot: import.meta.dirname,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
