import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ApiErr } from './api';
import { useI18n, type MsgKey } from './i18n';

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: (p: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode }) {
  const id = useId();
  const describedBy = [hint ? `${id}-h` : '', error ? `${id}-e` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field${error ? ' has-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {hint && <div className="hint" id={`${id}-h`}>{hint}</div>}
      {error && <div className="error-text" id={`${id}-e`} role="alert">{error}</div>}
    </div>
  );
}

export function useFormErrors() {
  const { t, err } = useI18n();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  return {
    fieldErrors, formError,
    clear: () => { setFieldErrors({}); setFormError(null); },
    fail: (e: unknown) => {
      if (e instanceof ApiErr) {
        const msg = err(e.code, e.params);
        if (e.field) setFieldErrors({ [e.field]: msg });
        else setFormError(msg);
        if (e.field) setFormError(`${t(`f.${e.field}` as MsgKey)}: ${msg}`);
      } else setFormError(t('err.server_error'));
    },
  };
}

export function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="alert alert-error" role="alert">{message}</div>;
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])');
        if (f.length === 0) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    return () => { document.removeEventListener('keydown', onKey); document.body.classList.remove('modal-open'); prev?.focus(); };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal${wide ? ' modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn btn-quiet" onClick={onClose} aria-label={t('common.close')}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'muted';
export function Badge({ tone = 'muted', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

/** Colour is never the only signal: the status text is always shown with the bar. */
export function Meter({ value, max, tone, label }: { value: number; max: number; tone: Tone; label: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="meter" role="img" aria-label={label}>
      <div className={`meter-fill meter-${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Empty({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

export function Loading() {
  const { t } = useI18n();
  return <p role="status" className="muted">{t('common.loading')}</p>;
}

export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    loader().then((d) => { if (live) { setData(d); setError(null); } }).catch((e) => { if (live) setError(e); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);
  return { data, error, reload: () => setTick((x) => x + 1), setData };
}

const ToastCtx = { push: (_m: string, _tone?: 'ok' | 'bad') => {} };
export const toast = (m: string, tone: 'ok' | 'bad' = 'ok') => ToastCtx.push(m, tone);
export function Toaster() {
  const [items, setItems] = useState<{ id: number; m: string; tone: string }[]>([]);
  useEffect(() => {
    let n = 0;
    ToastCtx.push = (m, tone = 'ok') => {
      const id = ++n;
      setItems((x) => [...x, { id, m, tone }]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 5000);
    };
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((i) => <div key={i.id} className={`toast toast-${i.tone}`}>{i.m}</div>)}
    </div>
  );
}

export function download(path: string) {
  window.location.href = '/api' + path;
}

export function ConfirmButton({ label, confirm, onConfirm, className = 'btn btn-danger' }: { label: string; confirm: string; onConfirm: () => void; className?: string }) {
  return <button className={className} onClick={() => { if (window.confirm(confirm)) onConfirm(); }}>{label}</button>;
}
