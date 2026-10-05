import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Trace a query',
  description:
    'Run a SQL query against live tables and step through FROM, JOIN, WHERE, GROUP BY, SELECT and ORDER BY as an animated trace in your browser.',
  alternates: { canonical: '/trace' },
  openGraph: {
    url: '/trace',
    title: 'QueryTrace | Trace a query',
  },
};

export default function TraceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
