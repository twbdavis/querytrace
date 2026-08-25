import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV !== 'production';

// The app is entirely same-origin and needs only WebAssembly compilation plus
// inline framework/styles. `wasm-unsafe-eval` permits sql.js without opening
// the broader JavaScript `unsafe-eval` capability in production.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "manifest-src 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  // COOP + COEP + CORP together grant `crossOriginIsolated`, hardening the
  // WASM/worker context against Spectre-class cross-origin reads. Safe here
  // because every resource (fonts, WASM, workers) is same-origin.
  { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  {
    key: 'Permissions-Policy',
    value:
      'accelerometer=(), autoplay=(), bluetooth=(), camera=(), display-capture=(), ' +
      'geolocation=(), gyroscope=(), hid=(), magnetometer=(), microphone=(), midi=(), ' +
      'payment=(), publickey-credentials-get=(), screen-wake-lock=(), serial=(), usb=(), xr-spatial-tracking=()',
  },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  ...(isDev
    ? []
    : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  compress: true,
  turbopack: { root: projectRoot },
  async headers() {
    return [
      { source: '/(.*)', headers: securityHeaders },
      {
        // The filename contains a content hash generated during postinstall, so
        // browsers/CDNs can retain it permanently without serving stale WASM.
        source: '/sql-wasm-browser.:hash.wasm',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ];
  },
};

export default nextConfig;
