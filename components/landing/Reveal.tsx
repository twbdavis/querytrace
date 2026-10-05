'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

interface RevealProps {
  children: ReactNode;
  className?: string;
  /** Stagger offset in ms, applied as a transition delay. */
  delay?: number;
}

type Phase = 'static' | 'hidden' | 'shown';

/**
 * Fades and lifts its children into place the first time they scroll into
 * view. Content renders visible by default (server HTML, no JS, reduced
 * motion); only once the script runs, and only for elements still below the
 * fold, is it hidden and then revealed by an IntersectionObserver. So a slow
 * hydration can never leave the page blank.
 */
export function Reveal({ children, className = '', delay = 0 }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>('static');

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // Anything already on screen (or nearly so) stays put; never hide it.
    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) return;

    setPhase('hidden');
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setPhase('shown');
          io.disconnect();
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.05 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const motionClass = phase === 'static' ? '' : phase === 'hidden' ? 'reveal' : 'reveal is-visible';

  return (
    <div
      ref={ref}
      className={`${motionClass} ${className}`}
      style={delay && phase !== 'static' ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
