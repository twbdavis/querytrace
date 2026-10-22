'use client';

import { useEffect, useRef } from 'react';
import { createJoinScene, T_END, type JoinPhase, type JoinSceneHandle } from './scene';
import { readFonts } from './tableTexture';

interface JoinCanvasProps {
  className?: string;
  /** Draw one finished frame and never animate. */
  still: boolean;
  paused: boolean;
  onPhase: (phase: JoinPhase) => void;
  onReady: () => void;
  onComplete: () => void;
  /** Rendering failed or the context was lost: the parent shows the static join. */
  onFail: () => void;
}

/**
 * Mounts the three.js join scene on a canvas that fills its parent. Resizes
 * with the parent, pauses when scrolled away or when the tab is hidden, and
 * feeds the pointer position in for the camera parallax. Disposes on unmount.
 */
export default function JoinCanvas({ className, still, paused, onPhase, onReady, onComplete, onFail }: JoinCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const callbacks = useRef({ onPhase, onReady, onComplete, onFail });
  callbacks.current = { onPhase, onReady, onComplete, onFail };
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const syncRef = useRef<() => void>(() => {});

  useEffect(() => {
    const canvas = ref.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    let scene: JoinSceneHandle | null = null;
    let cancelled = false;
    let intersecting = true;
    const cleanups: Array<() => void> = [];

    const sync = () => {
      if (still) return;
      scene?.setRunning(!pausedRef.current && intersecting && document.visibilityState === 'visible');
    };
    syncRef.current = sync;

    const safely = (action: () => void) => {
      if (cancelled) return;
      try { action(); }
      catch (error) {
        console.error('[QueryTrace] The join scene could not start.', error);
        scene?.setRunning(false);
        callbacks.current.onFail();
      }
    };

    const start = () => {
      if (cancelled) return;
      const lite = window.matchMedia('(pointer: coarse), (max-width: 767px)').matches;
      scene = createJoinScene(canvas, {
        fonts: readFonts(),
        lite,
        onPhase: (p) => callbacks.current.onPhase(p),
        onReady: () => callbacks.current.onReady(),
        onComplete: () => callbacks.current.onComplete(),
        onFail: () => callbacks.current.onFail(),
      });
      scene.setSize(host.clientWidth, host.clientHeight);

      const ro = new ResizeObserver(() => safely(() => {
        scene?.setSize(host.clientWidth, host.clientHeight);
        if (still) scene?.renderStill(T_END);
      }));
      ro.observe(host);
      cleanups.push(() => ro.disconnect());

      if (still) {
        scene.renderStill(T_END);
        return;
      }
      // A paused or off-screen scene still needs its first frame and controls.
      scene.renderStill(0);

      const io = new IntersectionObserver((entries) => {
        intersecting = entries.some((e) => e.isIntersecting);
        sync();
      }, { threshold: 0.05 });
      io.observe(host);
      cleanups.push(() => io.disconnect());

      document.addEventListener('visibilitychange', sync);
      cleanups.push(() => document.removeEventListener('visibilitychange', sync));

      if (!lite) {
        const move = (e: PointerEvent) => {
          const r = host.getBoundingClientRect();
          scene?.setPointer(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1);
        };
        const leave = () => scene?.setPointer(0, 0);
        host.addEventListener('pointermove', move);
        host.addEventListener('pointerleave', leave);
        cleanups.push(() => { host.removeEventListener('pointermove', move); host.removeEventListener('pointerleave', leave); });
      }
      sync();
    };

    // Table textures are drawn with the site's fonts; wait until they are in.
    const fontsReady = typeof document.fonts?.ready?.then === 'function' ? document.fonts.ready : Promise.resolve();
    fontsReady.then(() => safely(start), () => safely(start));

    return () => {
      cancelled = true;
      syncRef.current = () => {};
      for (const fn of cleanups) fn();
      scene?.dispose();
      scene = null;
    };
  }, [still]);

  useEffect(() => { syncRef.current(); }, [paused]);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
