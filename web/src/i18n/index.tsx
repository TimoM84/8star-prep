import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { en } from './en';
import { nl } from './nl';

export type Lang = 'nl' | 'en';
export type MsgKey = keyof typeof en;
const dict: Record<Lang, Record<string, string>> = { en, nl };

const LS = 'prep.lang';
export function initialLang(): Lang {
  try {
    const s = localStorage.getItem(LS);
    if (s === 'nl' || s === 'en') return s;
  } catch { /* storage unavailable */ }
  return navigator.language?.toLowerCase().startsWith('en') ? 'en' : 'nl';
}

export interface I18n {
  lang: Lang;
  locale: string;
  setLang: (l: Lang) => void;
  t: (key: MsgKey, params?: Record<string, string | number>) => string;
  /** Translates an API error code (`err.<code>`), falling back to a generic message. */
  err: (code: string, params?: Record<string, unknown>) => string;
  num: (v: number | null | undefined, digits?: number) => string;
  kcal: (v: number | null | undefined) => string;
  date: (iso: string | null | undefined) => string;
  dateTime: (iso: string | null | undefined) => string;
  weekday: (iso: string) => string;
}

const Ctx = createContext<I18n | null>(null);
export const useI18n = () => useContext(Ctx)!;

export function I18nProvider({ initial, onChange, children }: { initial: Lang; onChange?: (l: Lang) => void; children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initial);
  const locale = lang === 'nl' ? 'nl-NL' : 'en-GB';
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(LS, l); } catch { /* ignore */ }
    document.documentElement.lang = l;
    onChange?.(l);
  }, [onChange]);
  const value = useMemo<I18n>(() => {
    const t: I18n['t'] = (key, params) => {
      let s = dict[lang][key] ?? dict.en[key] ?? key;
      if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
      return s;
    };
    const nf = (d: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: d });
    return {
      lang, locale, setLang, t,
      err: (code, params) => {
        const key = `err.${code}` as MsgKey;
        return dict[lang][key] || dict.en[key] ? t(key, params as Record<string, string | number>) : t('err.server_error');
      },
      num: (v, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? '–' : nf(d).format(v)),
      kcal: (v) => (v === null || v === undefined ? '–' : `${nf(0).format(v)} kcal`),
      date: (iso) => (iso ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`)) : '–'),
      weekday: (iso) => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`)),
      dateTime: (iso) => {
        if (!iso) return '–';
        const d = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
        return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
      },
    };
  }, [lang, locale, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
