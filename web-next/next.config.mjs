// web-next/next.config.mjs
// /api/* ko existing Express backend (server/) par forward karta hai.
// Ye ek server-side PROXY hai — browser kabhi SQL Server se direct connect nahi karta,
// aur koi DB credential / JWT_SECRET browser bundle me nahi jata.
// Backend origin env se badla ja sakta hai: API_PROXY_TARGET (default http://localhost:4000).

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const API_TARGET = process.env.API_PROXY_TARGET || 'http://localhost:4000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Root repo me dusra package-lock.json hai, isliye Next ko apna folder batate hain
  // (workspace-root warning hatane ke liye).
  outputFileTracingRoot: dir,
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${API_TARGET}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;

