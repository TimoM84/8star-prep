import { useState, type ReactNode } from 'react';
import { post } from '../api';
import type { User } from '../App';
import { useI18n } from '../i18n';
import { ErrorBox, Field, useFormErrors } from '../ui';

export function Login({ onLogin, extra }: { onLogin: (u: User) => void; extra?: ReactNode }) {
  const { t, err } = useI18n();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fe = useFormErrors();
  void fe;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ user: User }>('/login', { username, password });
      onLogin(r.user);
    } catch (x: any) {
      setError(err(x.code ?? 'server_error', x.params));
    } finally { setBusy(false); }
  }
  return (
    <main className="login">
      <div className="login-lang">{extra}</div>
      <form className="card" onSubmit={submit}>
        <h1><span aria-hidden="true">★</span> 8star-prep</h1>
        <p className="muted">{t('auth.tagline')}</p>
        <ErrorBox message={error} />
        <Field label={t('auth.username')}>{(p) => <input {...p} autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />}</Field>
        <Field label={t('auth.password')}>{(p) => <input {...p} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}</Field>
        <button className="btn btn-primary btn-block" disabled={busy}>{t('auth.login')}</button>
        <p className="hint">{t('auth.selfHosted')}</p>
      </form>
    </main>
  );
}
