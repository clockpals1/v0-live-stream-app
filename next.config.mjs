/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // Cloudflare Workers has a 10 MiB compressed bundle limit on the
  // paid plan (3 MiB on free). Next.js eagerly bundles @vercel/og
  // (used by `next/og` ImageResponse) even when no route imports it,
  // costing ~2.2 MiB across resvg.wasm + yoga.wasm + the edge runtime.
  // We don't generate OG images, so alias the module to a tiny noop
  // and strip those wasm blobs out of the worker bundle.
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.resolve.alias = {
        ...(config.resolve.alias || {}),
        "next/og": false,
        "@vercel/og": false,
      };
    }
    return config;
  },
};

export default nextConfig;
