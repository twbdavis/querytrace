import type { Metadata } from 'next';
import { Space_Grotesk, Space_Mono } from 'next/font/google';
import './globals.css';

const ui = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-ui',
  display: 'swap',
});

const data = Space_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-data',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'QueryTrace — Visual SQL Learning DBMS',
  description:
    'Learn SQL by watching queries execute: joins pulse along foreign keys, filtered rows fade, and groups collapse into results, all on live tables in your browser.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${ui.variable} ${data.variable}`}>
      <body className="bg-app font-ui text-ink antialiased">{children}</body>
    </html>
  );
}
