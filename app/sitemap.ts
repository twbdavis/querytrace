import type { MetadataRoute } from 'next';

// Single-page app: the root is the only indexable URL. Baked at build time,
// so lastModified reflects the deploy that produced it.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: 'https://www.querytrace.net/',
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 1,
    },
  ];
}
