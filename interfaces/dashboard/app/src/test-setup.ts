import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { stubWebSocket } from './fake-websocket.ts';

// jsdom lacks these browser APIs; Radix primitives and the shadcn Sidebar call them.
class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** No media query matches by default; a test can replace `window.matchMedia` to simulate one. */
function noMatch(query: string): MediaQueryList {
  return {
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  };
}

function installBrowserPolyfills(): void {
  globalThis.ResizeObserver ??= NoopResizeObserver;
  window.matchMedia = noMatch;
  const proto = Element.prototype;
  if (!('hasPointerCapture' in proto)) Object.assign(proto, { hasPointerCapture: () => false });
  if (!('releasePointerCapture' in proto))
    Object.assign(proto, { releasePointerCapture: () => {} });
  if (!('scrollIntoView' in proto)) Object.assign(proto, { scrollIntoView: () => {} });
}

installBrowserPolyfills();

// No test may open a real connection.
beforeEach(() => {
  // Restore the default in case a test replaced it.
  window.matchMedia = noMatch;
  stubWebSocket();
});
afterEach(() => cleanup());
