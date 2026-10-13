import { useState } from 'react';
import { del, get, post, put } from '../api';
import type { User } from '../App';
import { useI18n, type MsgKey } from '../i18n';
import { Badge, ConfirmButton, ErrorBox, Field, Loading, Modal, toast, useFormErrors, useLoad } from '../ui';

const nz = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export function Settings({ user, setUser }: { user: User; setUser: (u: User) => void }) {
  const { t } = useI18n();
  const admin = user.role === 'admin';
  return (
    <>
      <div className="page-head"><h1>{t('nav.settings')}</h1></div>
      <nav className="subnav" aria-label={t('settings.sections')}>
        <a href="#/settings" onClick={(e) => { e.preventDefault(); document.getElementById('s-account')?.scrollIntoView(); }}>{t('settings.account')}</a>
        <a href="#/settings" onClick={(e) => { e.preventDefault(); document.getElementById('s-household')?.scrollIntoView(); }}>{t('settings.household')}</a>
        {admin && <a href="#/settings" onClick={(e) => { e.preventDefault(); document.getElementById('s-users')?.scrollIntoView(); }}>{t('settings.users')}</a>}
        {admin && <a href="#/settings" onClick={(e) => { e.preventDefault(); document.getElementById('s-mail')?.scrollIntoView(); }}>{t('settings.mail')}</a>}
        {admin && <a href="#/settings" onClick={(e) => { e.preventDefault(); document.getElementById('s-data')?.scrollIntoView(); }}>{t('settings.data')}</a>}
        <a href="#/settings" onClick={(e) => { e.preventDefault(); document.getElementById('s-about')?.scrollIntoView(); }}>{t('settings.about')}</a>
      </nav>
      <Account user={user} setUser={setUser} />
      <Household admin={admin} />
      {admin && <Users me={user} />}
      {admin && <Mail user={user} />}
      {admin && <Data />}
      <About />
    </>
  );
}

function Account({ user, setUser }: { user: User; setUser: (u: User) => void }) {
  const { t, lang, setLang } = useI18n();
  const fe = useFormErrors();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  async function change(e: React.FormEvent) {
    e.preventDefault(); fe.clear();
    try { await put('/me', { currentPassword: cur, newPassword: next }); setCur(''); setNext(''); toast(t('settings.passwordChanged')); }
    catch (x) { fe.fail(x); }
  }
  return (
    <section className="card" id="s-account" aria-labelledby="h-account">
      <h2 id="h-account">{t('settings.account')}</h2>
      <p>{t('settings.signedInAs', { name: user.username })} <Badge tone="info">{t(`role.${user.role}` as MsgKey)}</Badge></p>
      <Field label={t('common.language')} hint={t('settings.languageHint')}>{(p) => (
        <select {...p} value={lang} onChange={(e) => { setLang(e.target.value as 'nl' | 'en'); setUser({ ...user, language: e.target.value as 'nl' | 'en' }); }}>
          <option value="nl">Nederlands</option><option value="en">English</option>
        </select>)}</Field>
      <form onSubmit={change} noValidate>
        <h3>{t('settings.changePassword')}</h3>
        <ErrorBox message={fe.formError} />
        <div className="grid-2">
          <Field label={t('settings.currentPassword')} error={fe.fieldErrors.currentPassword ?? null}>{(p) => <input {...p} type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />}</Field>
          <Field label={t('settings.newPassword')} error={fe.fieldErrors.newPassword ?? null} hint={t('settings.passwordHint')}>{(p) => <input {...p} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />}</Field>
        </div>
        <button className="btn">{t('settings.changePassword')}</button>
      </form>
    </section>
  );
}

function Household({ admin }: { admin: boolean }) {
  const { t, num } = useI18n();
  const { data, reload } = useLoad(() => get('/household'));
  const fe = useFormErrors();
  const [member, setMember] = useState<any>(null);
  const [f, setF] = useState<any>(null);
  if (!data) return <Loading />;
  const st = data.settings;
  const form = f ?? { timezone: st.timezone, targetDays: String(st.targetDays), reminderDays: String(st.reminderDays), defaultLanguage: st.defaultLanguage };
  async function save(e: React.FormEvent) {
    e.preventDefault(); fe.clear();
    try { await put('/household', { timezone: form.timezone, targetDays: Number(form.targetDays), reminderDays: Number(form.reminderDays), defaultLanguage: form.defaultLanguage }); toast(t('product.saved')); setF(null); reload(); }
    catch (x) { fe.fail(x); }
  }
  const E = (k: string) => fe.fieldErrors[k] ?? null;
  return (
    <section className="card" id="s-household" aria-labelledby="h-household">
      <h2 id="h-household">{t('settings.household')}</h2>
      <form onSubmit={save} noValidate>
        <ErrorBox message={fe.formError} />
        <div className="grid-4">
          <Field label={t('settings.targetDays')} error={E('targetDays')}>{(p) => <input {...p} type="number" min={1} max={60} disabled={!admin} value={form.targetDays} onChange={(e) => setF({ ...form, targetDays: e.target.value })} />}</Field>
          <Field label={t('settings.reminderDays')} error={E('reminderDays')} hint={t('settings.reminderHint')}>{(p) => <input {...p} type="number" min={0} max={365} disabled={!admin} value={form.reminderDays} onChange={(e) => setF({ ...form, reminderDays: e.target.value })} />}</Field>
          <Field label={t('settings.timezone')} error={E('timezone')} hint={t('settings.timezoneHint')}>{(p) => <input {...p} disabled={!admin} value={form.timezone} onChange={(e) => setF({ ...form, timezone: e.target.value })} list="tzs" />}</Field>
          <Field label={t('settings.defaultLang')}>{(p) => <select {...p} disabled={!admin} value={form.defaultLanguage} onChange={(e) => setF({ ...form, defaultLanguage: e.target.value })}><option value="nl">Nederlands</option><option value="en">English</option></select>}</Field>
        </div>
        <datalist id="tzs">{['Europe/Amsterdam', 'Europe/Brussels', 'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'UTC'].map((z) => <option key={z} value={z} />)}</datalist>
        {admin && <button className="btn btn-primary">{t('common.save')}</button>}
      </form>

      <h3>{t('settings.members')}</h3>
      <p className="hint">{t('settings.membersHint')}</p>
      {data.members.length === 0 ? <p>{t('settings.noMembers')}</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th scope="col">{t('f.name')}</th><th scope="col">{t('f.kind')}</th><th scope="col" className="num">{t('settings.dailyKcal')}</th><th scope="col" className="num">{t('settings.dailyWater')}</th><th scope="col">{t('settings.macroTargets')}</th><th scope="col"><span className="sr-only">{t('common.actions')}</span></th></tr></thead>
          <tbody>{data.members.map((m: any) => (
            <tr key={m.id}>
              <th scope="row">{m.name}{m.isDemo && <> <Badge tone="info">{t('status.demo')}</Badge></>}</th>
              <td>{t(`kind.${m.kind}` as MsgKey)}{m.ageYears !== null && ` (${num(m.ageYears, 0)})`}</td>
              <td className="num">{num(m.kcal, 0)} {m.kcalIsEstimate ? <Badge tone="warn">{t('status.estimate')}</Badge> : <Badge tone="ok">{t('settings.custom')}</Badge>}</td>
              <td className="num">{num(m.waterL)} L</td>
              <td>{m.carbsG === null && m.proteinG === null && m.fatG === null ? '–' : `${num(m.carbsG, 0)} / ${num(m.proteinG, 0)} / ${num(m.fatG, 0)} g`}</td>
              <td className="row-actions">{admin && <><button className="btn" onClick={() => setMember(m)}>{t('common.edit')}</button>
                <ConfirmButton label={t('common.delete')} confirm={t('settings.confirmDeleteMember', { name: m.name })} onConfirm={async () => { await del(`/members/${m.id}`); reload(); }} /></>}</td>
            </tr>))}</tbody>
        </table></div>
      )}
      <div className="alert alert-info">{t('settings.estimateNote')}</div>
      {admin && <button className="btn" onClick={() => setMember({})}>＋ {t('settings.addMember')}</button>}
      {member && <MemberForm member={member} onClose={() => setMember(null)} onSaved={reload} />}
    </section>
  );
}

function MemberForm({ member, onClose, onSaved }: { member: any; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const fe = useFormErrors();
  const editing = member.id !== undefined;
  const [f, setF] = useState({ name: s(member.name), kind: member.kind ?? 'adult', ageYears: s(member.ageYears), kcal: member.kcalIsEstimate === false ? s(member.kcal) : '', waterL: s(member.waterL ?? 3), carbsG: s(member.carbsG), proteinG: s(member.proteinG), fatG: s(member.fatG) });
  const [estimate, setEstimate] = useState<number | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => {
    setF((x) => ({ ...x, [k]: e.target.value }));
  };
  async function refreshEstimate(kind = f.kind, age = f.ageYears) {
    const r = await get(`/estimates?kind=${kind}${age ? `&age=${age}` : ''}`);
    setEstimate(r.kcal);
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault(); fe.clear();
    const body = { name: f.name, kind: f.kind, ageYears: nz(f.ageYears), kcal: nz(f.kcal), waterL: nz(f.waterL), carbsG: nz(f.carbsG), proteinG: nz(f.proteinG), fatG: nz(f.fatG), kcalIsEstimate: nz(f.kcal) === null };
    try { if (editing) await put(`/members/${member.id}`, body); else await post('/members', body); toast(t('product.saved')); onSaved(); onClose(); }
    catch (x) { fe.fail(x); }
  }
  const E = (k: string) => fe.fieldErrors[k] ?? null;
  return (
    <Modal title={editing ? t('settings.editMember') : t('settings.addMember')} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <ErrorBox message={fe.formError} />
        <div className="grid-2">
          <Field label={t('f.name')} error={E('name')}>{(p) => <input {...p} value={f.name} onChange={set('name')} autoFocus />}</Field>
          <Field label={t('f.kind')}>{(p) => <select {...p} value={f.kind} onChange={(e) => { set('kind')(e); refreshEstimate(e.target.value); }}><option value="adult">{t('kind.adult')}</option><option value="child">{t('kind.child')}</option></select>}</Field>
          <Field label={t('f.ageYears')} error={E('ageYears')} hint={f.kind === 'child' ? t('settings.ageRequired') : undefined}>{(p) => <input {...p} inputMode="decimal" value={f.ageYears} onChange={(e) => { set('ageYears')(e); refreshEstimate(f.kind, e.target.value); }} />}</Field>
          <Field label={t('settings.dailyKcal')} error={E('kcal')} hint={estimate !== null ? t('settings.estimateIs', { n: estimate }) : t('settings.kcalHint')}>{(p) => <input {...p} inputMode="decimal" placeholder={estimate !== null ? String(estimate) : ''} value={f.kcal} onChange={set('kcal')} />}</Field>
          <Field label={t('settings.dailyWater')} error={E('waterL')} hint={t('settings.waterHint')}>{(p) => <input {...p} inputMode="decimal" value={f.waterL} onChange={set('waterL')} />}</Field>
        </div>
        <fieldset><legend>{t('settings.macroTargets')}</legend>
          <p className="hint">{t('settings.macroHint')}</p>
          <div className="grid-3">
            <Field label={`${t('f.carbs')} (g)`} error={E('carbsG')}>{(p) => <input {...p} inputMode="decimal" value={f.carbsG} onChange={set('carbsG')} />}</Field>
            <Field label={`${t('f.protein')} (g)`} error={E('proteinG')}>{(p) => <input {...p} inputMode="decimal" value={f.proteinG} onChange={set('proteinG')} />}</Field>
            <Field label={`${t('f.fat')} (g)`} error={E('fatG')}>{(p) => <input {...p} inputMode="decimal" value={f.fatG} onChange={set('fatG')} />}</Field>
          </div>
        </fieldset>
        <div className="actions"><button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn btn-primary">{t('common.save')}</button></div>
      </form>
    </Modal>
  );
}

function Users({ me }: { me: User }) {
  const { t, date } = useI18n();
  const { data, reload } = useLoad(() => get('/users'));
  const fe = useFormErrors();
  const [f, setF] = useState({ username: '', password: '', role: 'member', language: 'nl' });
  const [reset, setReset] = useState<any>(null);
  async function add(e: React.FormEvent) {
    e.preventDefault(); fe.clear();
    try { await post('/users', f); setF({ ...f, username: '', password: '' }); toast(t('product.saved')); reload(); } catch (x) { fe.fail(x); }
  }
  const E = (k: string) => fe.fieldErrors[k] ?? null;
  return (
    <section className="card" id="s-users" aria-labelledby="h-users">
      <h2 id="h-users">{t('settings.users')}</h2>
      <p className="hint">{t('settings.usersHint')}</p>
      {data && <div className="table-wrap"><table>
        <thead><tr><th scope="col">{t('auth.username')}</th><th scope="col">{t('settings.role')}</th><th scope="col">{t('common.language')}</th><th scope="col">{t('settings.created')}</th><th scope="col"><span className="sr-only">{t('common.actions')}</span></th></tr></thead>
        <tbody>{data.users.map((u: any) => (
          <tr key={u.id}><th scope="row">{u.username}</th><td>{t(`role.${u.role}` as MsgKey)}</td><td>{u.language.toUpperCase()}</td><td>{date(u.createdAt.slice(0, 10))}</td>
            <td className="row-actions">
              <button className="btn" onClick={() => setReset(u)}>{t('settings.resetPassword')}</button>
              <button className="btn" onClick={async () => { try { await put(`/users/${u.id}`, { role: u.role === 'admin' ? 'member' : 'admin' }); reload(); } catch (x: any) { toast(t(`err.${x.code}` as MsgKey), 'bad'); } }}>{u.role === 'admin' ? t('settings.makeMember') : t('settings.makeAdmin')}</button>
              {u.id !== me.id && <ConfirmButton label={t('common.delete')} confirm={t('settings.confirmDeleteUser', { name: u.username })} onConfirm={async () => { try { await del(`/users/${u.id}`); reload(); } catch (x: any) { toast(t(`err.${x.code}` as MsgKey), 'bad'); } }} />}
            </td></tr>))}</tbody>
      </table></div>}
      <form onSubmit={add} noValidate>
        <h3>{t('settings.addUser')}</h3>
        <ErrorBox message={fe.formError} />
        <div className="grid-4">
          <Field label={t('auth.username')} error={E('username')}>{(p) => <input {...p} autoCapitalize="none" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />}</Field>
          <Field label={t('auth.password')} error={E('password')} hint={t('settings.passwordHint')}>{(p) => <input {...p} type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />}</Field>
          <Field label={t('settings.role')}>{(p) => <select {...p} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="member">{t('role.member')}</option><option value="admin">{t('role.admin')}</option></select>}</Field>
          <Field label={t('common.language')}>{(p) => <select {...p} value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })}><option value="nl">Nederlands</option><option value="en">English</option></select>}</Field>
        </div>
        <button className="btn">{t('settings.addUser')}</button>
      </form>
      {reset && <ResetPassword user={reset} onClose={() => setReset(null)} />}
    </section>
  );
}

function ResetPassword({ user, onClose }: { user: any; onClose: () => void }) {
  const { t } = useI18n();
  const fe = useFormErrors();
  const [pw, setPw] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault(); fe.clear();
    try { await put(`/users/${user.id}`, { password: pw }); toast(t('settings.passwordChanged')); onClose(); } catch (x) { fe.fail(x); }
  }
  return (
    <Modal title={`${t('settings.resetPassword')}: ${user.username}`} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <ErrorBox message={fe.formError} />
        <Field label={t('settings.newPassword')} error={fe.fieldErrors.password ?? null} hint={t('settings.passwordHint')}>{(p) => <input {...p} type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />}</Field>
        <div className="actions"><button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn btn-primary">{t('common.save')}</button></div>
      </form>
    </Modal>
  );
}

function Mail({ user }: { user: User }) {
  const { t, dateTime, lang } = useI18n();
  const { data, reload, setData } = useLoad(() => get('/mail'));
  const fe = useFormErrors();
  const [f, setF] = useState<any>(null);
  const [rec, setRec] = useState({ email: '', language: 'nl' });
  const [testTo, setTestTo] = useState('');
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!data) return <Loading />;
  const form = f ?? { ...data.smtp, password: '' };
  const E = (k: string) => fe.fieldErrors[k] ?? null;
  async function save(e: React.FormEvent) {
    e.preventDefault(); fe.clear();
    try {
      const body: any = { host: form.host, port: Number(form.port), security: form.security, username: form.username, from: form.from, enabled: form.enabled, sendHour: Number(form.sendHour) };
      if (form.clearPassword) body.password = ''; else if (form.password) body.password = form.password;
      await put('/mail/smtp', body);
      toast(t('product.saved')); setF(null); reload();
    } catch (x) { fe.fail(x); }
  }
  async function addRec(e: React.FormEvent) {
    e.preventDefault();
    try { const r = await post('/mail/recipients', rec); setData({ ...data, recipients: r.recipients }); setRec({ ...rec, email: '' }); fe.clear(); } catch (x) { fe.fail(x); }
  }
  async function test(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setTestMsg(null);
    try {
      const r = await post('/mail/test', { to: testTo, language: lang });
      setTestMsg({ ok: r.ok, text: r.ok ? t('mail.testOk') : `${t('mail.testFailed')}: ${r.error === 'not_configured' ? t('err.smtp_not_configured') : r.error}` });
      setData({ ...data, history: r.history });
    } catch (x: any) { setTestMsg({ ok: false, text: t(`err.${x.code}` as MsgKey) }); } finally { setBusy(false); }
  }
  async function runNow() {
    setBusy(true);
    try {
      const r = await post('/mail/run');
      setData({ ...data, history: r.history });
      toast(r.result.status === 'not_configured' ? t('err.smtp_not_configured') : r.result.status === 'no_recipients' ? t('mail.noRecipients') : t('mail.runResult', { sent: r.result.sent, failed: r.result.failed, skipped: r.result.skipped }), r.result.failed ? 'bad' : 'ok');
    } finally { setBusy(false); }
  }
  return (
    <section className="card" id="s-mail" aria-labelledby="h-mail">
      <h2 id="h-mail">{t('settings.mail')}</h2>
      <p className="hint">{t('mail.intro')}</p>
      <form onSubmit={save} noValidate>
        <ErrorBox message={fe.formError} />
        <label className="inline-check"><input type="checkbox" checked={form.enabled} onChange={(e) => setF({ ...form, enabled: e.target.checked })} /> {t('mail.enabled')}</label>
        <div className="grid-4">
          <Field label={t('mail.host')} error={E('host')}>{(p) => <input {...p} value={form.host} onChange={(e) => setF({ ...form, host: e.target.value })} autoComplete="off" />}</Field>
          <Field label={t('mail.port')} error={E('port')}>{(p) => <input {...p} inputMode="numeric" value={form.port} onChange={(e) => setF({ ...form, port: e.target.value })} />}</Field>
          <Field label={t('mail.security')} hint={t('mail.securityHint')}>{(p) => (
            <select {...p} value={form.security} onChange={(e) => setF({ ...form, security: e.target.value, port: e.target.value === 'tls' ? 465 : e.target.value === 'starttls' ? 587 : form.port })}>
              <option value="starttls">STARTTLS</option><option value="tls">TLS (SSL)</option><option value="none">{t('mail.noTls')}</option>
            </select>)}</Field>
          <Field label={t('mail.sendHour')} error={E('sendHour')} hint={t('mail.sendHourHint')}>{(p) => <input {...p} type="number" min={0} max={23} value={form.sendHour} onChange={(e) => setF({ ...form, sendHour: e.target.value })} />}</Field>
          <Field label={t('mail.username')}>{(p) => <input {...p} value={form.username} autoComplete="off" onChange={(e) => setF({ ...form, username: e.target.value })} />}</Field>
          <Field label={t('mail.password')} hint={data.smtp.passwordSet ? t('mail.passwordSet') : t('mail.passwordNotSet')}>{(p) => <input {...p} type="password" autoComplete="new-password" placeholder={data.smtp.passwordSet ? '••••••••' : ''} value={form.password} onChange={(e) => setF({ ...form, password: e.target.value })} />}</Field>
          <Field label={t('mail.from')} error={E('from')} hint={t('mail.fromHint')}>{(p) => <input {...p} value={form.from} onChange={(e) => setF({ ...form, from: e.target.value })} placeholder="Noodvoorraad <pantry@example.org>" />}</Field>
          {data.smtp.passwordSet && <div className="field check-field"><label><input type="checkbox" checked={!!form.clearPassword} onChange={(e) => setF({ ...form, clearPassword: e.target.checked })} /> {t('mail.clearPassword')}</label></div>}
        </div>
        <button className="btn btn-primary">{t('common.save')}</button>
      </form>

      <h3>{t('mail.recipients')}</h3>
      {data.recipients.length === 0 ? <p>{t('mail.noRecipients')}</p> : (
        <ul className="plain">{data.recipients.map((r: any) => (
          <li key={r.id} className="recipient">
            <span>{r.email}</span>
            <select aria-label={`${t('common.language')}: ${r.email}`} value={r.language} onChange={async (e) => { const x = await put(`/mail/recipients/${r.id}`, { language: e.target.value, active: r.active }); setData({ ...data, recipients: x.recipients }); }}>
              <option value="nl">Nederlands</option><option value="en">English</option></select>
            <label className="inline-check"><input type="checkbox" checked={r.active} onChange={async (e) => { const x = await put(`/mail/recipients/${r.id}`, { language: r.language, active: e.target.checked }); setData({ ...data, recipients: x.recipients }); }} /> {t('mail.active')}</label>
            <ConfirmButton label={t('common.delete')} confirm={t('mail.confirmRemove', { email: r.email })} onConfirm={async () => { const x = await del(`/mail/recipients/${r.id}`); setData({ ...data, recipients: x.recipients }); }} />
          </li>))}</ul>
      )}
      <form onSubmit={addRec} className="inline-form" noValidate>
        <Field label={t('mail.email')} error={E('email')}>{(p) => <input {...p} type="email" value={rec.email} onChange={(e) => setRec({ ...rec, email: e.target.value })} />}</Field>
        <Field label={t('common.language')}>{(p) => <select {...p} value={rec.language} onChange={(e) => setRec({ ...rec, language: e.target.value })}><option value="nl">Nederlands</option><option value="en">English</option></select>}</Field>
        <button className="btn">{t('mail.addRecipient')}</button>
      </form>

      <h3>{t('mail.testTitle')}</h3>
      <form onSubmit={test} className="inline-form">
        <Field label={t('mail.testTo')}>{(p) => <input {...p} type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder={user.username.includes('@') ? user.username : ''} required />}</Field>
        <button className="btn" disabled={busy}>{t('mail.sendTest')}</button>
        <button type="button" className="btn" disabled={busy} onClick={runNow}>{t('mail.runNow')}</button>
      </form>
      {testMsg && <div className={`alert ${testMsg.ok ? 'alert-ok' : 'alert-error'}`} role="status">{testMsg.text}</div>}

      <h3>{t('mail.history')}</h3>
      {data.history.length === 0 ? <p>{t('mail.noHistory')}</p> : (
        <div className="table-wrap"><table className="compact">
          <thead><tr><th scope="col">{t('mail.when')}</th><th scope="col">{t('mail.kind')}</th><th scope="col">{t('mail.to')}</th><th scope="col">{t('mail.subject')}</th><th scope="col">{t('f.status')}</th></tr></thead>
          <tbody>{data.history.map((h: any) => (
            <tr key={h.id}><td>{dateTime(h.at)}</td><td>{t(`mail.kind_${h.kind}` as MsgKey)}{h.kind === 'expiry' && ` (${h.itemCount})`}</td><td>{h.recipientEmail}</td><td>{h.subject}</td>
              <td><Badge tone={h.status === 'sent' ? 'ok' : 'bad'}>{t(`mail.${h.status}` as MsgKey)}</Badge>{h.error && <div className="small text-bad">{h.error}</div>}</td></tr>))}</tbody>
        </table></div>
      )}
    </section>
  );
}

function Data() {
  const { t } = useI18n();
  const { data, reload } = useLoad(() => get('/demo'));
  const [error, setError] = useState<string | null>(null);
  const { err } = useI18n();
  if (!data) return <Loading />;
  return (
    <section className="card" id="s-data" aria-labelledby="h-data">
      <h2 id="h-data">{t('settings.data')}</h2>
      <h3>{t('data.demoTitle')}</h3>
      <p>{t('data.demoText')}</p>
      <ErrorBox message={error} />
      {data.loaded ? (
        <>
          <p><Badge tone="info">{t('status.demo')}</Badge> {t('data.demoLoaded')}</p>
          <ConfirmButton label={t('data.demoRemove')} confirm={t('data.demoConfirm')} onConfirm={async () => { await del('/demo'); toast(t('common.deleted')); reload(); }} />
        </>
      ) : <button className="btn" onClick={async () => { setError(null); try { await post('/demo'); toast(t('data.demoAdded')); reload(); } catch (x: any) { setError(err(x.code ?? 'server_error')); } }}>{t('data.demoLoad')}</button>}
      <h3>{t('data.backupTitle')}</h3>
      <p>{t('data.backupText')}</p>
    </section>
  );
}

function About() {
  const { t } = useI18n();
  return (
    <section className="card" id="s-about" aria-labelledby="h-about">
      <h2 id="h-about">{t('settings.about')}</h2>
      <p>{t('about.text')}</p>
      <h3>{t('about.data')}</h3>
      <p>{t('about.dataText')}</p>
      <p className="hint">{t('dash.disclaimer')}</p>
    </section>
  );
}
