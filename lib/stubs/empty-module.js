// Empty stub. Aliased in next.config.mjs#turbopack.resolveAlias for
// optional dependencies we don't actually use (e.g. @vercel/og), so
// they don't get bundled into the Cloudflare Worker. Kept tiny on
// purpose — every byte counts against the 10 MiB Worker bundle limit.
module.exports = {};
