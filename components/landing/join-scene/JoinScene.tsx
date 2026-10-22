'use client';

import dynamic from 'next/dynamic';
import { Component, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import s from '../landing.module.css';
import { StaticJoin, STATIC_JOIN_DESCRIPTION } from './StaticJoin';
import type { JoinPhase } from './scene';

export type { JoinPhase };

const JoinCanvas = dynamic(
  () => import('./JoinCanvas'),
  { ssr: false },
);

/** An optional illustration must never take the page's links down with it. */
class SceneBoundary extends Component<{ children: ReactNode; onFail: () => void }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch() { this.props.onFail(); }

  render() { return this.state.failed ? null : this.props.children; }
}

export const SCENE_DESCRIPTION =
  'Two tables, SCREENING and VENUE, joined on VENUE_ID: a wire runs between the key columns, pulses travel along it, each matched pair of rows lights up, and the selected cells fly together to build the result table, which then holds.';

type Mode = 'pending' | 'live' | 'still' | 'fallback';

function supportsWebGL(): boolean {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

interface JoinSceneProps {
  onPhase?: (phase: JoinPhase) => void;
}

/**
 * The 3D join scene. With reduced motion it renders one finished frame and
 * never animates. A failed download, renderer or WebGL context falls back to
 * a static vector drawing of the same join without interrupting the page.
 */
const noop = () => {};

export function JoinScene({ onPhase = noop }: JoinSceneProps) {
  const [mode, setMode] = useState<Mode>('pending');
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    if (!supportsWebGL()) { setMode('fallback'); return; }
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => {
      setReady(false);
      setComplete(false);
      // A motion preference change must not retry a broken renderer/download.
      setMode((current) => current === 'fallback' ? current : preference.matches ? 'still' : 'live');
    };
    sync();
    preference.addEventListener('change', sync);
    return () => preference.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (mode === 'fallback') onPhase('hold');
  }, [mode, onPhase]);

  const showCanvas = mode === 'live' || mode === 'still';
  const fail = () => { setReady(false); setMode('fallback'); };

  return (
    <div
      className={s.scene}
      data-mode={mode}
      data-playback={mode === 'live' ? complete ? 'complete' : paused ? 'paused' : 'playing' : mode}
      data-rise
      style={{ '--i': 1 } as CSSProperties}
    >
      <div className={s.sceneVisual} role="img" aria-label={mode === 'fallback' ? STATIC_JOIN_DESCRIPTION : SCENE_DESCRIPTION}>
        {showCanvas && (
          <SceneBoundary onFail={fail}>
            <JoinCanvas
              key={mode}
              className={`${s.canvas} ${ready ? s.canvasOn : ''}`}
              still={mode === 'still'}
              paused={paused}
              onPhase={onPhase}
              onReady={() => setReady(true)}
              onComplete={() => setComplete(true)}
              onFail={fail}
            />
          </SceneBoundary>
        )}
        {mode === 'fallback' && <StaticJoin />}
      </div>
      {mode === 'live' && ready && (
        <button
          type="button"
          className={s.sceneControl}
          disabled={complete}
          onClick={() => setPaused((current) => !current)}
        >
          {complete ? 'Animation complete' : paused ? 'Resume animation' : 'Pause animation'}
        </button>
      )}
    </div>
  );
}
