/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    instrumentationHook: true,
    serverComponentsExternalPackages: ['@prisma/client', 'puppeteer-extra', 'puppeteer-extra-plugin-stealth'],
  },
};

module.exports = nextConfig;
