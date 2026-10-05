import type { MetadataRoute } from 'next';

// Two indexable URLs: the landing page and the tracer itself. Baked at build
// time, so lastModified reflects the deploy that produced it.
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    {
      url: 'https://www.querytrace.net/',
      lastModified,
      changeFrequency: 'monthly',
      priority: 1,
    },
    {
      url: 'https://www.querytrace.net/trace',
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.9,
    },
  ];
}
