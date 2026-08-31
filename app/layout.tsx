import type { Metadata, Viewport } from 'next';
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

const siteUrl = 'https://www.querytrace.net';
const siteDescription =
  'Learn SQL by watching queries execute: joins pulse along foreign keys, filtered rows fade, and groups collapse into results, all on live tables in your browser.';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'QueryTrace | Visual SQL Learning Tool',
    template: '%s · QueryTrace',
  },
  description: siteDescription,
  applicationName: 'QueryTrace',
  keywords: [
    'learn SQL',
    'SQL visualization',
    'SQL tutorial',
    'interactive SQL practice',
    'SQL joins explained',
    'GROUP BY visualization',
    'SQL execution trace',
    'SQLite in the browser',
    'database teaching tool',
    'visual query debugger',
  ],
  category: 'education',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: '/',
    siteName: 'QueryTrace',
    title: 'QueryTrace | Visual SQL Learning Tool',
    description: siteDescription,
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'QueryTrace | Visual SQL Learning Tool',
    description: siteDescription,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
};

export const viewport: Viewport = {
  themeColor: '#090d18',
  colorScheme: 'dark',
};

// Crawlable summary of what the app does - the UI itself renders almost no
// indexable prose because every panel is live application chrome.
const structuredData = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: 'QueryTrace',
  url: siteUrl,
  description: siteDescription,
  applicationCategory: 'EducationalApplication',
  operatingSystem: 'Any',
  browserRequirements: 'Requires JavaScript and WebAssembly',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  featureList: [
    'Step-by-step animated SQL execution tracing',
    'Live joins, WHERE filters, GROUP BY, HAVING, ORDER BY and subquery visualization',
    'Row provenance: click any result row to see every source row it came from',
    'Built-in lessons and custom schemas, all running on SQLite compiled to WebAssembly',
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${ui.variable} ${data.variable}`}>
      <body className="bg-app font-ui text-ink antialiased">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
        {children}
      </body>
    </html>
  );
}
