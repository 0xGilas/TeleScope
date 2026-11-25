import { useEffect, type RefObject } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let openDialogCount = 0;
let savedBodyOverflow = '';

function isFocusableVisible(el: HTMLElement): boolean {
  if (el.hasAttribute('hidden') || el.closest('[hidden]')) return false;
  if (el.getClientRects().length === 0) return false;
  const style = window.getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

function getVisibleFocusables(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    isFocusableVisible,
  );
}

function lockBodyScroll(): void {
  if (openDialogCount === 0) {
    savedBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  openDialogCount += 1;
  document.body.dataset.dialogCount = String(openDialogCount);
}

function unlockBodyScroll(): void {
  openDialogCount = Math.max(0, openDialogCount - 1);
  if (openDialogCount === 0) {
    delete document.body.dataset.dialogCount;
    document.body.style.overflow = savedBodyOverflow;
    savedBodyOverflow = '';
  } else {
    document.body.dataset.dialogCount = String(openDialogCount);
  }
}

export function useDialogAccessibility(
  open: boolean,
  containerRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!open) return;

    const previousFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    lockBodyScroll();

    const focusTimer = window.setTimeout(() => {
      const container = containerRef.current;
      if (!container) return;
      const focusables = getVisibleFocusables(container);
      const first = focusables[0] ?? container;
      if (!container.contains(document.activeElement)) {
        first.focus({ preventScroll: true });
      }
    }, 10);

    const onKeyDown = (e: KeyboardEvent) => {
      const container = containerRef.current;
      if (e.key !== 'Tab' || !container) return;
      const focusables = getVisibleFocusables(container);
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first || !container.contains(document.activeElement)) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last || !container.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKeyDown);
      unlockBodyScroll();
      if (previousFocused?.isConnected) {
        previousFocused.focus({ preventScroll: true });
      }
    };
  }, [open, containerRef]);
}
