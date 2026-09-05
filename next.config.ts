import type { NextConfig } from "next";

const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
// next.config is evaluated at process start. If a parent shell left
// NODE_ENV=production while running `next dev`, the CSP must still allow
// eval or React / Firebase break in the browser.
const isNextDev = process.argv.includes("dev") || process.env.NODE_ENV !== "production";

/**
 * Content-Security-Policy.
 *
 * `unsafe-inline` for styles is required by the inline `style` attributes used
 * throughout the dashboard, and Razorpay's checkout injects its own script and
 * iframe, hence the explicit allowances below.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  // 'unsafe-eval' is required by the Next.js / React dev runtime.
  `script-src 'self' 'unsafe-inline'${isNextDev ? " 'unsafe-eval'" : ""} https://checkout.razorpay.com https://apis.google.com https://www.gstatic.com https://*.firebaseapp.com`,
  "frame-src 'self' https://checkout.razorpay.com https://api.razorpay.com https://*.firebaseapp.com https://accounts.google.com",
  `connect-src 'self' ${apiUrl} https://*.googleapis.com https://*.firebaseio.com https://securetoken.googleapis.com https://identitytoolkit.googleapis.com https://lumberjack.razorpay.com https://api.razorpay.com wss://*.firebaseio.com https://accounts.google.com`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join("; ");
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  // Nothing in Tuff needs these device APIs.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(self)",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,

  images: {
    formats: ["image/webp"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.firebasestorage.app",
      },
    ],
    deviceSizes: [640, 750, 828, 1080, 1200],
    imageSizes: [16, 32, 48, 64, 96],
    minimumCacheTTL: 60 * 60 * 24 * 365,
    // Remote SVGs are not rendered through the optimizer, so there is no reason
    // to accept them and inherit their script-execution risk.
    dangerouslyAllowSVG: false,
  },

  headers: async () => [
    {
      // Every document response is private and must not be stored. The previous
      // blanket `public, max-age=31536000, immutable` let browsers and any
      // shared proxy or CDN cache authenticated dashboard HTML for a year.
      source: "/:path*",
      headers: [
        ...securityHeaders,
        { key: "Cache-Control", value: "private, no-cache, no-store, max-age=0, must-revalidate" },
      ],
    },
    {
      // Next.js already sets immutable caching on its own hashed build output,
      // so only the static assets in /public need a rule here.
      source: "/:path*.(svg|png|jpg|jpeg|webp|ico|woff|woff2)",
      headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }],
    },
  ],

  compress: true,
  poweredByHeader: false,

  experimental: {
    optimizePackageImports: ["lucide-react"],
  },

  turbopack: {},
};

export default nextConfig;
