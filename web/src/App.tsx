import { useCallback, useEffect, useState } from 'react';
import { get, post, put, setUnauthorizedHandler } from './api';
import { I18nProvider, initialLang, useI18n, type Lang, type MsgKey } from './i18n';
import { Toaster } from './ui';
import { Catalogue } from './pages/Catalogue';
import { Dashboard } from './pages/Dashboard';
import { Expiry } from './pages/Expiry';
import { Inventory } from './pages/Inventory';
import { Login } from './pages/Login';
import { Plan } from './pages/Plan';
import { Settings } from './pages/Settings';

export interface User { id: number; username: string; role: 'admin' | 'member'; language: Lang }
export const ROUTES = ['dashboard', 'inventory', 'catalogue', 'plan', 'expiry', 'settings'] as const;
type Route = (typeof ROUTES)[number];

function currentRoute(): Route {
  const h = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  return (ROUTES as readonly string[]).includes(h) ? (h as Route) : 'dashboard';
}

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    get<{ user: User | null }>('/me').then((r) => setUser(r.user)).catch(() => setUser(null));
  }, []);
  const lang = user?.language ?? initialLang();
  const onLang = useCallback((l: Lang) => { if (user) put('/me', { language: l }).catch(() => {}); }, [user]);
  return (
    <I18nProvider key={user === undefined ? 'boot' : user ? `u${user.id}` : 'anon'} initial={lang} onChange={onLang}>
      <Shell user={user} setUser={setUser} />
      <Toaster />
    </I18nProvider>
  );
}

function LangSwitch() {
  const { lang, setLang, t } = useI18n();
  return (
    <div className="lang-switch" role="group" aria-label={t('common.language')}>
      {(['nl', 'en'] as const).map((l) => (
        <button key={l} className={`btn btn-quiet${lang === l ? ' active' : ''}`} aria-pressed={lang === l} lang={l} onClick={() => setLang(l)}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function Shell({ user, setUser }: { user: User | null | undefined; setUser: (u: User | null) => void }) {
  const { t } = useI18n();
  const [route, setRoute] = useState<Route>(currentRoute());
  useEffect(() => {
    const on = () => { setRoute(currentRoute()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  useEffect(() => { document.title = user ? `${t(`nav.${route}` as MsgKey)} – 8star-prep` : '8star-prep'; }, [route, user, t]);

  if (user === undefined) return <main className="center"><p role="status">{t('common.loading')}</p></main>;
  if (user === null) return <Login onLogin={setUser} extra={<LangSwitch />} />;

  const logout = async () => { try { await post('/logout'); } finally { setUser(null); } };
  return (
    <>
      <a className="skip" href="#main">{t('common.skip')}</a>
      <header className="topbar">
        <div className="brand"><span aria-hidden="true">★</span> 8star-prep</div>
        <nav aria-label={t('nav.label')} className="nav">
          {ROUTES.map((r) => (
            <a key={r} href={`#/${r}`} aria-current={route === r ? 'page' : undefined} className={route === r ? 'active' : ''}>
              <span className="nav-icon" aria-hidden="true">{ICONS[r]}</span>
              <span>{t(`nav.${r}` as MsgKey)}</span>
            </a>
          ))}
        </nav>
        <div className="topbar-right">
          <LangSwitch />
          <span className="user muted" title={user.role === 'admin' ? t('role.admin') : t('role.member')}>{user.username}</span>
          <button className="btn btn-quiet" onClick={logout}>{t('auth.logout')}</button>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        {route === 'dashboard' && <Dashboard user={user} />}
        {route === 'inventory' && <Inventory user={user} />}
        {route === 'catalogue' && <Catalogue user={user} />}
        {route === 'plan' && <Plan user={user} />}
        {route === 'expiry' && <Expiry user={user} />}
        {route === 'settings' && <Settings user={user} setUser={setUser} />}
      </main>
    </>
  );
}

const ICONS: Record<Route, string> = { dashboard: '◧', inventory: '▤', catalogue: '≣', plan: '☰', expiry: '⏲', settings: '⚙' };
