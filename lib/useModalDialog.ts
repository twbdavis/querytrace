'use client';

import { useEffect, useRef } from 'react';

const focusableSelector = [
  'button', 'a[href]', 'input', 'select', 'textarea', '[tabindex]', '[contenteditable="true"]',
].join(',');

/** Native modality makes the background inert; keep Tab and focus restoration inside the app. */
export function useModalDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const invokingControl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const cancel = (event: Event) => {
      event.preventDefault();
      close.current();
    };
    const trapTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const controls = [...dialog.querySelectorAll<HTMLElement>(focusableSelector)].filter((element) =>
        element.tabIndex >= 0 && !element.matches(':disabled') && !element.closest('[inert]')
        && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden'
      );
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) { event.preventDefault(); return; }
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener('cancel', cancel);
    dialog.addEventListener('keydown', trapTab);
    dialog.showModal();

    return () => {
      dialog.removeEventListener('cancel', cancel);
      dialog.removeEventListener('keydown', trapTab);
      dialog.close();
      // A dialog-to-dialog transition first restores the original opener;
      // the next showModal call then takes focus and remembers that opener.
      if (invokingControl?.isConnected && !document.querySelector('dialog[open]')) {
        invokingControl.focus({ preventScroll: true });
      }
    };
  }, [open]);

  return ref;
}
