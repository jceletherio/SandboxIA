/** @type {import('next').NextConfig} */

// Hosts extras autorizados a carregar /_next/* em dev. Sem isso o Next recusa
// requests do dev server vindas de outra origem — é o caso de abrir a UI pelo IP
// da máquina na LAN (celular na mesma rede). Ajuste com
// NEXT_DEV_ORIGINS="192.168.1.48,outro-host.local" se o IP mudar.
const devOrigins = (process.env.NEXT_DEV_ORIGINS || '192.168.1.124')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const nextConfig = {
  allowedDevOrigins: devOrigins,
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
