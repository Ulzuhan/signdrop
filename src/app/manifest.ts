import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SignDrop — Client-Side PDF Signing',
    short_name: 'SignDrop',
    description: 'Client-side PDF signing and cryptographic sealing with zero-knowledge privacy.',
    start_url: '/',
    display: 'standalone',
    background_color: '#05070d',
    theme_color: '#05070d',
    icons: [
      {
        src: '/kaicorp-mark.png',
        sizes: '192x192',
        type: 'image/png',
      },
    ],
  };
}
