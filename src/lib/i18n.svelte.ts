/**
 * Reactive i18n wrapper around paraglide (E1.6).
 *
 * The paraglide runtime is compiled with the `localStorage` strategy, so
 * `setLocale` persists the choice under `PARAGLIDE_LOCALE` and `getLocale`
 * reads it back. On first visit we fall back to the browser language.
 *
 * Usage in components: `{i18n.m.some_key()}` — reading the `m` getter tracks
 * the locale state, so all message calls re-render when the locale changes.
 */
import * as messages from '../paraglide/messages';
import {
  getLocale,
  setLocale as paraglideSetLocale,
  locales,
  localStorageKey,
  type Locale,
} from '../paraglide/runtime';

function storedLocale(): Locale | null {
  try {
    const stored = localStorage.getItem(localStorageKey);
    if (stored && locales.includes(stored as Locale)) return stored as Locale;
  } catch {
    // storage unavailable — fall through to browser-language detection
  }
  return null;
}

function initialLocale(): Locale {
  return (
    storedLocale() ??
    (typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('de')
      ? 'de'
      : 'en')
  );
}

const startLocale = initialLocale();
paraglideSetLocale(startLocale);
if (typeof document !== 'undefined') document.documentElement.lang = startLocale;

class I18nStore {
  locale = $state<Locale>(startLocale);

  /** Reactive message namespace: reading it tracks `locale`. */
  get m() {
    void this.locale;
    return messages;
  }

  set(locale: Locale): void {
    paraglideSetLocale(locale); // persists via the localStorage strategy
    this.locale = locale;
    if (typeof document !== 'undefined') document.documentElement.lang = locale;
  }
}

export const i18n = new I18nStore();
export { locales };
export type { Locale };
export { getLocale };
