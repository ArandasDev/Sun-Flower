import { getNonce, setNonce } from 'get-nonce';
import { afterEach, describe, expect, it } from 'vitest';
import { installStyleNonce, readStyleNonce } from './style-nonce.ts';

function setMeta(content: string | null): void {
  document.head.querySelector('meta[name="csp-nonce"]')?.remove();
  if (content === null) return;
  const meta = document.createElement('meta');
  meta.name = 'csp-nonce';
  meta.content = content;
  document.head.append(meta);
}

afterEach(() => setMeta(null));

describe('readStyleNonce', () => {
  it('returns the meta value', () => {
    setMeta('abc123');
    expect(readStyleNonce()).toBe('abc123');
  });

  it('returns null without the meta', () => {
    expect(readStyleNonce()).toBeNull();
  });

  it('returns null for an empty value', () => {
    setMeta('');
    expect(readStyleNonce()).toBeNull();
  });

  it('returns null for the placeholder left by the Vite dev server', () => {
    setMeta('__CSP_NONCE__');
    expect(readStyleNonce()).toBeNull();
  });
});

describe('installStyleNonce', () => {
  // get-nonce keeps the nonce in module state; an empty value reads back as unset.
  afterEach(() => setNonce(''));

  it('hands the meta value to get-nonce', () => {
    setMeta('abc123');
    installStyleNonce();
    expect(getNonce()).toBe('abc123');
  });

  it('leaves get-nonce unset for the placeholder', () => {
    setMeta('__CSP_NONCE__');
    installStyleNonce();
    expect(getNonce()).toBeUndefined();
  });
});
