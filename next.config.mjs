/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // @supabase/ssr and @supabase/supabase-js are compiled with tsup/esbuild
  // using keepNames:true, which injects a `__name` helper into their dist
  // files. Turbopack (Next 16 default) strips or misorders that helper,
  // causing "ReferenceError: __name is not defined" in the browser bundle.
  // Listing these packages here forces Next.js to re-compile them through
  // its own transform pipeline, which handles the helper correctly.
  transpilePackages: ["@supabase/ssr", "@supabase/supabase-js"],
  // Cloudflare Workers caps the worker bundle at 10 MiB compressed on
  // the paid plan (3 MiB on free). Next.js eagerly bundles @vercel/og
  // (used by `next/og` ImageResponse) into the server runtime even
  // when no route imports it — that's ~2.2 MiB of resvg.wasm +
  // yoga.wasm + edge runtime. We don't generate OG images, so we
  // alias both module specifiers at the Turbopack level to a tiny
  // stub. Turbopack is the default bundler from Next 16; webpack
  // config is rejected.
  turbopack: {
    resolveAlias: {
      "next/og": "./lib/stubs/empty-module.js",
      "@vercel/og": "./lib/stubs/empty-module.js",
    },
  },
};

export default nextConfig;
