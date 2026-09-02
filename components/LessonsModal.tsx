'use client';

import { useEffect, useRef } from 'react';
import { LESSONS, type Lesson } from '@/lib/lessons';
import { schemaById } from '@/lib/schemas';
import { useAppStore } from '@/store/useAppStore';
import { BookIcon, CheckIcon, CloseIcon, PlayIcon } from './Icons';

interface LessonsModalProps {
  open: boolean;
  onClose: () => void;
}

const SECTIONS: Lesson['section'][] = ['Foundations', 'Combining data'];

export function LessonsModal({ open, onClose }: LessonsModalProps) {
  const setSql = useAppStore((s) => s.setSql);
  const runQuery = useAppStore((s) => s.runQuery);
  const loadSchema = useAppStore((s) => s.loadSchema);
  const schemaDef = useAppStore((s) => s.schemaDef);
  const ranLessons = useAppStore((s) => s.ranLessons);
  const markLessonRun = useAppStore((s) => s.markLessonRun);
  const done = Object.values(ranLessons).filter(Boolean).length;
  const pressedBackdrop = useRef(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  /** Make sure the lesson's schema is loaded, then put its query in place. */
  const prepare = async (lesson: Lesson): Promise<boolean> => {
    if (schemaDef.id !== lesson.schemaId) {
      const def = schemaById(lesson.schemaId);
      if (!def) return false;
      const res = await loadSchema(def);
      if (!res.ok) return false;
    }
    setSql(lesson.query);
    return true;
  };

  return (
    <>
      {open && (
        <div
          className="modal-backdrop-enter fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm max-sm:items-end max-sm:p-0"
          // Close only for a press that starts and ends on the backdrop, so a
          // drag that begins inside the dialog (selecting text) never closes it.
          onMouseDown={(e) => {
            pressedBackdrop.current = e.target === e.currentTarget;
          }}
          onClick={(e) => {
            const startedOnBackdrop = pressedBackdrop.current;
            pressedBackdrop.current = false;
            if (startedOnBackdrop && e.target === e.currentTarget) onClose();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Lessons"
            className="modal-dialog-enter flex max-h-[85vh] w-full max-w-4xl flex-col rounded-md border border-line-strong bg-panel max-sm:h-[100dvh] max-sm:max-h-none max-sm:rounded-none max-sm:border-0"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3 max-sm:min-h-14 max-sm:px-3 max-sm:pt-[calc(0.75rem+env(safe-area-inset-top))]">
              <span className="inline-flex items-center gap-2 font-ui text-[12px] font-bold uppercase tracking-[0.2em] text-ink">
                <BookIcon size={14} className="text-accent-active" />
                lessons
                <span className="rounded-full bg-node px-2 py-0.5 font-data text-[10px] tabular-nums text-ink-mute">
                  {done} / {LESSONS.length} run
                </span>
              </span>
              <button
                onClick={onClose}
                aria-label="Close lessons"
                className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-ink-dim transition-colors hover:bg-white/5 hover:text-ink max-sm:h-9 max-sm:w-9"
              >
                <CloseIcon size={13} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4 max-sm:p-3 max-sm:pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
              {SECTIONS.map((section) => (
                <div key={section} className="mb-4 last:mb-0">
                  <div className="mb-2 font-ui text-[10px] font-bold uppercase tracking-[0.25em] text-ink-mute">
                    {section}
                  </div>
                  <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                    {LESSONS.filter((l) => l.section === section).map((lesson) => {
                      const ran = !!ranLessons[lesson.id];
                      return (
                        <div
                          key={lesson.id}
                          className="flex flex-col rounded-md border border-line bg-node p-3 transition-colors hover:border-line-strong max-sm:p-3.5"
                        >
                          <div className="mb-1.5 flex items-center justify-between gap-2">
                            <span className="font-ui text-[12px] font-medium text-ink">
                              {lesson.title}
                            </span>
                            <span className="flex items-center gap-1.5">
                              <span className="rounded-sm bg-app px-1.5 py-0.5 font-data text-[8px] uppercase tracking-wider text-ink-mute">
                                {schemaById(lesson.schemaId)?.name.split(' ')[0] ?? lesson.schemaId}
                              </span>
                              {ran && (
                                <span
                                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent-result/15 text-accent-result"
                                  title="You ran this lesson"
                                >
                                  <CheckIcon size={9} />
                                </span>
                              )}
                            </span>
                          </div>
                          <p className="mb-2 text-[11px] leading-relaxed text-ink-dim">
                            {lesson.concept}
                          </p>
                          <pre className="mb-2 overflow-x-auto whitespace-pre-wrap rounded bg-app p-2 font-data text-[10px] leading-snug text-ink">
                            {lesson.query}
                          </pre>
                          <p className="mb-2.5 text-[10px] italic leading-relaxed text-accent-filter/70">
                            Try it: {lesson.tryIt}
                          </p>
                          <div className="mt-auto flex items-center gap-2">
                            <button
                              aria-label={`Run lesson: ${lesson.title}`}
                              onClick={() => {
                                void (async () => {
                                  if (!(await prepare(lesson))) return;
                                  await markLessonRun(lesson.id);
                                  void runQuery(lesson.query);
                                  onClose();
                                })();
                              }}
                              className="inline-flex cursor-pointer items-center gap-1.5 rounded border border-accent-active bg-accent-active/10 px-2.5 py-1 font-ui text-[10px] font-bold tracking-wider text-accent-active transition-colors hover:bg-accent-active/20 max-sm:min-h-10 max-sm:px-3"
                            >
                              <PlayIcon size={9} />
                              RUN
                            </button>
                            <button
                              aria-label={`Load lesson into editor: ${lesson.title}`}
                              onClick={() => {
                                void (async () => {
                                  if (await prepare(lesson)) onClose();
                                })();
                              }}
                              className="cursor-pointer rounded border border-line-strong px-2.5 py-1 font-ui text-[10px] font-bold tracking-wider text-ink transition-colors hover:border-accent-active hover:text-accent-active max-sm:min-h-10 max-sm:flex-1 max-sm:px-3"
                            >
                              LOAD INTO EDITOR
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
