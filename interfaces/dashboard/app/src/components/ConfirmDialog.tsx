import { AlertDialog as AlertDialogPrimitive } from 'radix-ui';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
} from './ui/alert-dialog.tsx';
import { Button } from './ui/button.tsx';

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
 * Modal confirmation on the Radix AlertDialog, shown while mounted: focus starts on Cancelar,
 * Tab stays inside, Escape and a click outside cancel, and focus returns to the opener (or to
 * `returnFocusRef`). Opened from inside a Sheet, Escape closes only this dialog.
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
  const cancelRef = useRef<HTMLButtonElement>(null);
  // There is no Radix Trigger (the callers mount the dialog to open it), so the element that had
  // focus when it opened is kept here to give focus back on close.
  const [opener] = useState(() => document.activeElement);

  // A confirm button that turns disabled drops focus; after a failed attempt, bring it back.
  const wasPending = useRef(false);
  useEffect(() => {
    if ((wasPending.current && !pending) || (!pending && error !== null)) {
      cancelRef.current?.focus();
    }
    wasPending.current = pending;
  }, [pending, error]);

  const cancel = (): void => {
    if (!pending) onCancel();
  };

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) cancel();
      }}
    >
      <AlertDialogPortal>
        <AlertDialogOverlay onClick={cancel} />
        <AlertDialogPrimitive.Content
          data-slot="alert-dialog-content"
          // The confirmations keep the dialog role the screens and their tests rely on.
          role="dialog"
          className="fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:max-w-lg"
          {...(children === undefined ? { 'aria-describedby': undefined } : {})}
          onEscapeKeyDown={(event) => {
            if (pending) event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            // A caller whose opener is about to disappear names where focus goes instead.
            event.preventDefault();
            const target = returnFocusRef?.current ?? opener;
            if (target instanceof HTMLElement && target.isConnected) target.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
          </AlertDialogHeader>
          {children === undefined ? null : (
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-3 text-sm text-foreground">{children}</div>
            </AlertDialogDescription>
          )}
          <p role="alert" className="text-sm font-semibold text-destructive empty:hidden">
            {error}
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel ref={cancelRef} disabled={pending}>
              Cancelar
            </AlertDialogCancel>
            {/* A plain button, not AlertDialogAction: the dialog closes only after success. */}
            <Button type="button" variant="destructive" disabled={pending} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPrimitive.Content>
      </AlertDialogPortal>
    </AlertDialog>
  );
}
