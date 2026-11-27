type Listener = (message: string) => void;

const listeners = new Set<Listener>();

/** Shows a short confirmation after an action succeeded; errors never go through here. */
export function notify(message: string): void {
  for (const listener of listeners) listener(message);
}

/** The Toaster listens here; returns the function that stops listening. */
export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test helper: drops every listener so toasts do not leak between tests. */
export function resetToasts(): void {
  listeners.clear();
}
