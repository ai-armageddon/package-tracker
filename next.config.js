/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    instrumentationHook: true,
    serverComponentsExternalPackages: ['@prisma/client', '@anthropic-ai/sdk'],
  },
};

module.exports = nextConfig;
