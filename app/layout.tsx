import type { Metadata, Viewport } from 'next';
import PWAInstall from '@/components/PWAInstall';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sugi Sale Logger',
  description: 'One-tap Sugi product sale logger',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0f766e',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        {children}
        <PWAInstall />
      </body>
    </html>
  );
}
