/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Reown AppKit (WalletConnect) menarik dependency yang mereferensikan paket Node-only
  // (pino-pretty, lokijs, encoding). Docs Reown menyarankan `webpack.externals.push(...)`,
  // tapi Next.js 16 memakai Turbopack secara default dan menolak build kalau ada config
  // `webpack` tanpa config `turbopack` -- jadi dipakai `serverExternalPackages` (opsi resmi
  // Next yang bekerja di kedua bundler) sebagai pengganti.
  serverExternalPackages: ["pino-pretty", "lokijs", "encoding"],
  // Header keamanan dasar. Sengaja BELUM ada CSP penuh: Reown/WalletConnect memuat
  // banyak domain, jadi mulai dulu dengan `Content-Security-Policy-Report-Only`
  // di staging sebelum memberlakukannya. `frame-ancestors 'none'` aman diberlakukan
  // sekarang (melarang situs lain membingkai app ini = anti-clickjacking).
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  turbopack: {
    // Konektor Coinbase/Base Account di wagmi menarik @coinbase/cdp-sdk, yang meng-import
    // secara dinamis paket pembayaran x402 (@x402/*) sebagai dependency opsional. Kita tidak
    // memakai fitur itu sama sekali, dan paketnya tidak ter-install, jadi tanpa alias ini
    // build gagal "Module not found". Diarahkan ke modul kosong -- import dinamis itu
    // memang tidak pernah dipanggil dari alur connect wallet.
    resolveAlias: {
      "@x402/core/client": "./lib/web3/empty-module.js",
      "@x402/evm": "./lib/web3/empty-module.js",
      "@x402/evm/exact/client": "./lib/web3/empty-module.js",
      "@x402/evm/upto/client": "./lib/web3/empty-module.js",
      "@x402/svm/exact/client": "./lib/web3/empty-module.js",
    },
  },
};

export default nextConfig;
