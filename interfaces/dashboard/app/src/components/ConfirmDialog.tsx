import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href]';

interface ConfirmDialogProps {
  title: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** True while the action runs: both buttons are disabled so it cannot be sent twice. */
  pending?: boolean;
  /** Text of a failed attempt, shown inside the dialog. */
  error?: string | null;
  /** Where focus goes on close when the ref holds an element; otherwise back to the opener. */
  returnFocusRef?: RefObject<HTMLElement | null>;
  children?: ReactNode;
}

/**
 * Modal confirmation: focus moves to the cancel button, Tab stays inside, Escape and the
 * backdrop cancel, and focus returns to what had it before.
 */
export function ConfirmDialog({
  title,
  confirmLabel,
  onConfirm,
  onCancel,
  pending = false,
  error = null,
  returnFocusRef,
  children,
}: ConfirmDialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const cancelCallback = useRef(onCancel);
  const pendingRef = useRef(pending);

  useEffect(() => {
    cancelCallback.current = onCancel;
    pendingRef.current = pending;
  }, [onCancel, pending]);

  useEffect(() => {
    const previous = document.activeElement;
    cancelRef.current?.focus();
    return () => {
      // A caller whose opener is about to disappear names where focus goes instead.
      const target = returnFocusRef?.current ?? previous;
      if (target instanceof HTMLElement && target.isConnected) target.focus();
    };
  }, [returnFocusRef]);

  // A confirm button that turns disabled drops focus; after a failed attempt, bring it back.
  const wasPending = useRef(false);
  useEffect(() => {
    if ((wasPending.current && !pending) || (!pending && error !== null)) {
      cancelRef.current?.focus();
    }
    wasPending.current = pending;
  }, [pending, error]);

  // On the document, so the keys keep working even when focus is on the page body.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        if (!pendingRef.current) cancelCallback.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [];
      const first = items[0];
      const last = items[items.length - 1];
      if (first === undefined || last === undefined) return;
      const active = document.activeElement;
      const inside = active instanceof Node && panelRef.current?.contains(active) === true;
      if (!inside) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel();
      }}
    >
      <div
        ref={panelRef}
        className="dialog panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId}>{title}</h2>
        {children}
        <p className="dialog-error" role="alert">
          {error}
        </p>
        <div className="dialog-actions">
          <button
            ref={cancelRef}
            type="button"
            className="button button-quiet"
            disabled={pending}
            onClick={onCancel}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="button button-primary"
            disabled={pending}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
