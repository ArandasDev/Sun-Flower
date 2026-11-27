import type { ComponentProps, ReactNode, Ref } from 'react';
import { Button } from './ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog.tsx';

interface AddDialogProps {
  /** Text of the button that opens the dialog. */
  triggerLabel: string;
  triggerVariant?: ComponentProps<typeof Button>['variant'];
  triggerSize?: ComponentProps<typeof Button>['size'];
  /** Extra description of the trigger, for a label that repeats on the screen. */
  triggerDescribedBy?: string;
  triggerRef?: Ref<HTMLButtonElement>;
  title: string;
  submitLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
  /** True while the request runs: submit is disabled and the dialog stays open. */
  pending: boolean;
  /** False while the fields are not valid yet. */
  canSubmit: boolean;
  /** Text of a failed attempt, shown inside the dialog. */
  error: string | null;
  children: ReactNode;
}

/**
 * The add form of a list screen, in a Radix Dialog opened by its trigger. The caller owns
 * `open`: it closes the dialog on success, and Radix then gives focus back to the trigger. On a
 * failure the dialog stays open with the error. Escape and "Fechar" close it without sending,
 * except while a request runs.
 */
export function AddDialog({
  triggerLabel,
  triggerVariant = 'default',
  triggerSize = 'default',
  triggerDescribedBy,
  triggerRef,
  title,
  submitLabel,
  open,
  onOpenChange,
  onSubmit,
  pending,
  canSubmit,
  error,
  children,
}: AddDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next || !pending) onOpenChange(next);
      }}
    >
      <DialogTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant={triggerVariant}
          size={triggerSize}
          aria-describedby={triggerDescribedBy}
        >
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent aria-describedby={undefined}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit && !pending) onSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          {children}
          <p role="alert" className="text-sm text-destructive empty:hidden">
            {error}
          </p>
          <DialogFooter>
            <Button type="submit" disabled={pending || !canSubmit}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
