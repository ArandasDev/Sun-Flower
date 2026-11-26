import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { XIcon } from 'lucide-react';
import { Toast as ToastPrimitive } from 'radix-ui';

import { cn } from '../../lib/utils.ts';

// shadcn-style wrapper around Radix Toast (Sonner injects an un-nonced <style>, see decision 0025).

// Provider renders no element, so it has no data-slot.
const ToastProvider = ToastPrimitive.Provider;

/** Top of the screen below 768 px, bottom-right corner from there up. */
function ToastViewport({
  className,
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Viewport>) {
  return (
    <ToastPrimitive.Viewport
      data-slot="toast-viewport"
      className={cn(
        'fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse gap-2 p-4 outline-none md:top-auto md:right-0 md:bottom-0 md:max-w-[420px] md:flex-col',
        className,
      )}
      {...props}
    />
  );
}

const toastVariants = cva(
  'group pointer-events-auto relative flex w-full items-center justify-between gap-2 overflow-hidden rounded-md border p-4 pr-8 shadow-lg transition-all data-[state=closed]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:animate-in data-[state=open]:slide-in-from-top-full md:data-[state=open]:slide-in-from-bottom-full data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-(--radix-toast-swipe-end-x) data-[swipe=end]:animate-out data-[swipe=move]:translate-x-(--radix-toast-swipe-move-x) data-[swipe=move]:transition-none',
  {
    variants: {
      variant: {
        default: 'bg-popover text-popover-foreground',
        destructive: 'destructive border-destructive/50 bg-popover text-destructive',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function Toast({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Root> & VariantProps<typeof toastVariants>) {
  return (
    <ToastPrimitive.Root
      data-slot="toast"
      data-variant={variant}
      className={cn(toastVariants({ variant }), className)}
      {...props}
    />
  );
}

function ToastAction({ className, ...props }: React.ComponentProps<typeof ToastPrimitive.Action>) {
  return (
    <ToastPrimitive.Action
      data-slot="toast-action"
      className={cn(
        'inline-flex h-8 shrink-0 items-center justify-center rounded-md border bg-transparent px-3 text-sm font-medium transition-colors outline-none hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

/** Close button; its accessible name is "Fechar". */
function ToastClose({ className, ...props }: React.ComponentProps<typeof ToastPrimitive.Close>) {
  return (
    <ToastPrimitive.Close
      data-slot="toast-close"
      className={cn(
        'absolute top-2 right-2 rounded-xs p-1 opacity-70 transition-opacity outline-none hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50',
        className,
      )}
      {...props}
    >
      <XIcon className="size-4" aria-hidden="true" />
      <span className="sr-only">Fechar</span>
    </ToastPrimitive.Close>
  );
}

function ToastTitle({ className, ...props }: React.ComponentProps<typeof ToastPrimitive.Title>) {
  return (
    <ToastPrimitive.Title
      data-slot="toast-title"
      className={cn('text-sm font-semibold', className)}
      {...props}
    />
  );
}

function ToastDescription({
  className,
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Description>) {
  return (
    <ToastPrimitive.Description
      data-slot="toast-description"
      className={cn('text-sm opacity-90', className)}
      {...props}
    />
  );
}

export {
  Toast,
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  toastVariants,
};
