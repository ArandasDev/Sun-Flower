import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, readThemeChoice, resolveTheme, useTheme } from './theme.ts';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  document.documentElement.classList.remove('dark');
});

describe('resolveTheme', () => {
  it('follows prefersDark for system', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('ignores prefersDark for light and dark', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('readThemeChoice', () => {
  it('returns the stored choice', () => {
    localStorage.setItem('sunflower-theme', 'dark');
    expect(readThemeChoice()).toBe('dark');
  });

  it('returns system when localStorage.getItem throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readThemeChoice()).toBe('system');
  });

  it('returns system for an unknown value', () => {
    localStorage.setItem('sunflower-theme', 'purple');
    expect(readThemeChoice()).toBe('system');
  });
});

describe('applyTheme', () => {
  it('adds the dark class for dark and removes it for light', () => {
    applyTheme('dark');
    expect(document.documentElement).toHaveClass('dark');
    applyTheme('light');
    expect(document.documentElement).not.toHaveClass('dark');
  });
});

describe('useTheme', () => {
  it('stores the choice and applies the class', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setChoice('dark'));
    expect(localStorage.getItem('sunflower-theme')).toBe('dark');
    expect(result.current.choice).toBe('dark');
    expect(document.documentElement).toHaveClass('dark');
  });

  it('still applies the theme when setItem throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setChoice('dark'));
    expect(result.current.choice).toBe('dark');
    expect(document.documentElement).toHaveClass('dark');
  });

  it('follows prefers-color-scheme changes on system', () => {
    let dark = false;
    const listeners = new Set<() => void>();
    window.matchMedia = (query: string): MediaQueryList =>
      ({
        get matches() {
          return dark;
        },
        media: query,
        addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
      }) as unknown as MediaQueryList;

    renderHook(() => useTheme());
    expect(document.documentElement).not.toHaveClass('dark');
    dark = true;
    act(() => listeners.forEach((listener) => listener()));
    expect(document.documentElement).toHaveClass('dark');
  });
});
