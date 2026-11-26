import { useCallback, useEffect, useState } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';

export const THEME_STORAGE_KEY = 'sunflower-theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === 'light' || value === 'dark' || value === 'system';
}

/** The stored choice; `system` when storage is unavailable or holds an unknown value. */
export function readThemeChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeChoice(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

function storeThemeChoice(choice: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Storage blocked (private browsing, policy): the choice lasts for this page only.
  }
}

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): 'light' | 'dark' {
  if (choice === 'system') return prefersDark ? 'dark' : 'light';
  return choice;
}

function prefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;
}

/** Puts or removes the `dark` class on `<html>`. */
export function applyTheme(choice: ThemeChoice, doc: Document = document): void {
  const theme = resolveTheme(choice, prefersDark());
  doc.documentElement.classList.toggle('dark', theme === 'dark');
}

export function useTheme(): { choice: ThemeChoice; setChoice(next: ThemeChoice): void } {
  const [choice, setChoiceState] = useState<ThemeChoice>(readThemeChoice);

  useEffect(() => {
    applyTheme(choice);
    if (choice !== 'system' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(DARK_QUERY);
    const onChange = (): void => applyTheme('system');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [choice]);

  const setChoice = useCallback((next: ThemeChoice): void => {
    storeThemeChoice(next);
    setChoiceState(next);
  }, []);

  return { choice, setChoice };
}
