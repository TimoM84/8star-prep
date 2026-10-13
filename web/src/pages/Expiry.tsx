import { useState } from 'react';
import { get } from '../api';
import type { User } from '../App';
import { useI18n, type MsgKey } from '../i18n';
import { Badge, Empty, Loading, useLoad, type Tone } from '../ui';

const tone: Record<string, Tone> = { ok: 'ok', due: 'warn', expired_tht: 'warn', expired_tgt: 'bad', unknown: 'muted' };

export function Expiry({ user }: { user: User }) {
  const { t, num, date } = useI18n();
  const { data, error } = useLoad(() => get('/products'));
  const house = useLoad(() => get('/household'));
  const [filter, setFilter] = useState('attention');
  if (error) return <p className="alert alert-error" role="alert">{t('err.server_error')}</p>;
  if (!data || !house.data) return <Loading />;
  const today: string = data.today;
  const days = (iso: string) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  const rows = data.products.flatMap((p: any) => p.batches.filter((b: any) => b.remainingBase > 0).map((b: any) => ({ p, b })))
    .filter(({ b }: any) => filter === 'all' || (filter === 'attention' ? b.status !== 'ok' && b.status !== 'unknown' : b.status === filter))
    .sort((a: any, b: any) => (a.b.expiryDate ?? '9999').localeCompare(b.b.expiryDate ?? '9999'));
  return (
    <>
      <div className="page-head"><h1>{t('nav.expiry')}</h1></div>
      <p>{t('exp.intro', { n: house.data.settings.reminderDays })} {user.role === 'admin' && <a href="#/settings">{t('exp.configureMail')}</a>}</p>
      <div className="alert alert-info">{t('exp.disclaimer')}</div>
      <div className="toolbar">
        <div className="field"><label htmlFor="ef">{t('inv.filter')}</label>
          <select id="ef" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="attention">{t('exp.fAttention')}</option><option value="due">{t('status.due')}</option><option value="expired_tgt">{t('status.expired_tgt')}</option>
            <option value="expired_tht">{t('status.expired_tht')}</option><option value="unknown">{t('status.unknown')}</option><option value="all">{t('common.all')}</option>
          </select></div>
      </div>
      {rows.length === 0 ? <Empty title={t('exp.emptyTitle')} text={t('exp.emptyText')} /> : (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">{t('nav.expiry')}</caption>
            <thead><tr><th scope="col">{t('f.name')}</th><th scope="col">{t('inv.remaining')}</th><th scope="col">{t('f.expiryDate')}</th><th scope="col">{t('exp.when')}</th><th scope="col">{t('f.status')}</th></tr></thead>
            <tbody>
              {rows.map(({ p, b }: any) => (
                <tr key={b.id}>
                  <th scope="row">{p.name}{p.location && <div className="muted small">{p.location}</div>}</th>
                  <td>{num(b.remaining, 2)} {t(`unit.${b.unit}` as MsgKey)}</td>
                  <td>{b.expiryDate ? <>{date(b.expiryDate)} <span className="muted">({t(`exp.${b.expiryKind}` as MsgKey)})</span></> : t('exp.unknown')}</td>
                  <td>{b.expiryDate ? (days(b.expiryDate) >= 0 ? t('exp.inDays', { n: days(b.expiryDate) }) : t('exp.agoDays', { n: -days(b.expiryDate) })) : '–'}</td>
                  <td><Badge tone={tone[b.status]}>{t(`status.${b.status}` as MsgKey)}</Badge>{b.status === 'expired_tht' && <div className="hint">{t('exp.thtReview')}</div>}{b.status === 'expired_tgt' && <div className="hint">{t('exp.tgtExcluded')}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
