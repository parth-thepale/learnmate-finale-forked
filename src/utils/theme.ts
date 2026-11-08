export type Theme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'learnmate_theme';
const THEME_STORAGE_KEY_V1 = 'learnmate_theme_v1';

export function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const themeParam = urlParams.get('theme');
    if (themeParam === 'dark' || themeParam === 'light') {
      return themeParam;
    }
    const saved = (localStorage.getItem(THEME_STORAGE_KEY) || localStorage.getItem(THEME_STORAGE_KEY_V1)) as Theme | null;
    if (saved === 'light' || saved === 'dark') {
      return saved;
    }
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
  } catch {
    // ignore
  }
  return 'light';
}

export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  if (theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    localStorage.setItem(THEME_STORAGE_KEY_V1, theme);
  } catch {
    // ignore
  }
}
