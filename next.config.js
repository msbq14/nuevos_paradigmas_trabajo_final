/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // El servidor necesita ejecutar binarios (docker) y escribir archivos generados.
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client", "prisma"],
  },
};

module.exports = nextConfig;
