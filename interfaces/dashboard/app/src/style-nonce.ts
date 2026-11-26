import { setNonce } from 'get-nonce';

/** Placeholder the server replaces per request; the Vite dev server serves it untouched. */
const NONCE_PLACEHOLDER = '__CSP_NONCE__';

/** Reads the per-request style nonce the server writes into `<meta name="csp-nonce">`. */
export function readStyleNonce(doc: Document = document): string | null {
  const content = doc.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')?.content ?? '';
  if (content === '' || content === NONCE_PLACEHOLDER) return null;
  return content;
}

/** Hands the nonce to `get-nonce`, which Radix uses for the `<style>` tags it injects. */
export function installStyleNonce(doc: Document = document): void {
  const nonce = readStyleNonce(doc);
  if (nonce !== null) setNonce(nonce);
}
