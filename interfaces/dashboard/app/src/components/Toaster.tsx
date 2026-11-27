import { useEffect, useState } from 'react';
import { subscribeToasts } from '../toast.ts';
import { Toast, ToastClose, ToastProvider, ToastTitle, ToastViewport } from './ui/toast.tsx';

const DURATION_MS = 4000;

interface Entry {
  key: number;
  message: string;
}

/** Renders one Radix Toast per `notify` message; each leaves on its own after 4 s. */
export function Toaster() {
  const [entries, setEntries] = useState<Entry[]>([]);

  useEffect(() => {
    let next = 0;
    return subscribeToasts((message) => {
      next += 1;
      setEntries((current) => [...current, { key: next, message }]);
    });
  }, []);

  const remove = (key: number): void => {
    setEntries((current) => current.filter((entry) => entry.key !== key));
  };

  return (
    <ToastProvider duration={DURATION_MS}>
      {entries.map((entry) => (
        <Toast
          key={entry.key}
          onOpenChange={(open) => {
            if (!open) remove(entry.key);
          }}
        >
          <ToastTitle>{entry.message}</ToastTitle>
          <ToastClose />
        </Toast>
      ))}
      <ToastViewport label="Notificações ({hotkey})" />
    </ToastProvider>
  );
}
