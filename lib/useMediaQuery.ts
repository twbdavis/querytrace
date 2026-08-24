'use client';

import { useEffect, useState } from 'react';

/** Reactive matchMedia — drives the per-screen-size layout switch. */
export function useMediaQuery(query: string): boolean {
  // Keep the server render and the client's first render identical. Reading
  // matchMedia in the initializer makes desktop clients hydrate mobile HTML
  // as desktop HTML, which React correctly treats as a mismatch.
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
