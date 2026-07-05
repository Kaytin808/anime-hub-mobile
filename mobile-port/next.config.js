/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  images: {
    domains: ['image.tmdb.org']
  }
};
module.exports = nextConfig;
