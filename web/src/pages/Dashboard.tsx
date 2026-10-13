import { useState } from 'react';
import { get } from '../api';
import type { User } from '../App';
import { ProductForm } from '../components/ProductForm';
import { useI18n, type MsgKey } from '../i18n';
import { Badge, Empty, Loading, Meter, useLoad, type Tone } from '../ui';

function toneFor(days: number | null, target: number): Tone {
  if (days === null) return 'muted';
  if (days >= target) return 'ok';
  return days >= target / 2 ? 'warn' : 'bad';
}
function statusKey(days: number | null, target: number): MsgKey {
  if (days === null) return 'status.unknown';
  if (days >= target) return 'status.met';
  return days >= target / 2 ? 'status.partial' : 'status.short';
}

export function Dashboard({ user }: { user: User }) {
  const { t, num, kcal, date } = useI18n();
  const { data, error, reload } = useLoad(() => get('/dashboard'));
  const [adding, setAdding] = useState(false);
  if (error) return <p className="alert alert-error" role="alert">{t('err.server_error')}</p>;
  if (!data) return <Loading />;
  const c = data.coverage;
  const target = c.targetDays;
  const noMembers = data.members.length === 0;
  const stock = c.food.kcal > 0 || c.water.litres > 0 || c.missingNutrition.length > 0;
  const mt = c.macroTargets;
  const macroRow = (key: 'carbs' | 'protein' | 'fat', label: MsgKey) => (
    <tr><th scope="row">{t(label)}</th><td>{num(c.food[key], 0)} g</td><td>{mt[key] === null ? '–' : `${num(mt[key] * target, 0)} g`}</td></tr>
  );
  return (
    <>
      <div className="page-head">
        <h1>{t('nav.dashboard')}</h1>
        <button className="btn btn-primary btn-lg" onClick={() => setAdding(true)}>＋ {t('product.add')}</button>
      </div>
      {data.demoLoaded && <div className="alert alert-info" role="status">{t('dash.demoBanner')} {user.role === 'admin' && <a href="#/settings">{t('dash.demoManage')}</a>}</div>}
      {noMembers && <div className="alert alert-warn"><strong>{t('dash.noMembers')}</strong> {user.role === 'admin' ? <a href="#/settings">{t('dash.addMembers')}</a> : t('dash.askAdmin')}</div>}
      {data.plan?.stale && <div className="alert alert-warn" role="status">{t('dash.planStale')} <a href="#/plan">{t('dash.planRecalc')}</a></div>}
      {data.kcalEstimateMembers > 0 && <div className="alert alert-info">{t('dash.estimateTargets')}</div>}

      {!noMembers && !stock ? (
        <Empty title={t('dash.emptyTitle')} text={t('dash.emptyText')} action={<button className="btn btn-primary" onClick={() => setAdding(true)}>{t('product.add')}</button>} />
      ) : (
        <>
          <section className="cards" aria-label={t('dash.coverage')}>
            <article className="card">
              <h2>{t('dash.overall')}</h2>
              <p className="big">{c.overallDays === null ? '–' : num(c.overallDays, 1)} <small>{t('dash.of', { n: target })}</small></p>
              <Badge tone={toneFor(c.overallDays, target)}>{t(statusKey(c.overallDays, target))}</Badge>
              <Meter value={c.overallDays ?? 0} max={target} tone={toneFor(c.overallDays, target)} label={`${t('dash.overall')}: ${num(c.overallDays)} / ${target}`} />
              <p className="hint">{t('dash.overallHint')}</p>
            </article>
            <article className="card">
              <h2>{t('dash.food')}</h2>
              <p className="big">{c.food.days === null ? '–' : num(c.food.days, 1)} <small>{t('dash.daysUnit')}</small></p>
              <Badge tone={toneFor(c.food.days, target)}>{t(statusKey(c.food.days, target))}</Badge>
              <Meter value={c.food.days ?? 0} max={target} tone={toneFor(c.food.days, target)} label={`${t('dash.food')}: ${num(c.food.days)} / ${target}`} />
              <dl className="kv">
                <dt>{t('dash.available')}</dt><dd>{kcal(c.food.kcal)}</dd>
                <dt>{t('dash.dailyNeed')}</dt><dd>{kcal(c.food.dailyKcal)}</dd>
                <dt>{t('dash.needFor', { n: target })}</dt><dd>{kcal(c.food.dailyKcal * target)}</dd>
                <dt>{t('dash.shortage')}</dt><dd className={c.food.shortageKcal > 0 ? 'text-bad' : 'text-ok'}>{c.food.shortageKcal > 0 ? kcal(c.food.shortageKcal) : t('dash.none')}</dd>
              </dl>
            </article>
            <article className="card">
              <h2>{t('dash.water')}</h2>
              <p className="big">{c.water.days === null ? '–' : num(c.water.days, 1)} <small>{t('dash.daysUnit')}</small></p>
              <Badge tone={toneFor(c.water.days, target)}>{t(statusKey(c.water.days, target))}</Badge>
              <Meter value={c.water.days ?? 0} max={target} tone={toneFor(c.water.days, target)} label={`${t('dash.water')}: ${num(c.water.days)} / ${target}`} />
              <dl className="kv">
                <dt>{t('dash.available')}</dt><dd>{num(c.water.litres)} L</dd>
                <dt>{t('dash.dailyNeed')}</dt><dd>{num(c.water.dailyLitres)} L</dd>
                <dt>{t('dash.needFor', { n: target })}</dt><dd>{num(c.water.dailyLitres * target)} L</dd>
                <dt>{t('dash.shortage')}</dt><dd className={c.water.shortageLitres > 0 ? 'text-bad' : 'text-ok'}>{c.water.shortageLitres > 0 ? `${num(c.water.shortageLitres)} L` : t('dash.none')}</dd>
              </dl>
            </article>
          </section>

          <section className="card">
            <h2>{t('dash.shortagesTitle', { n: target })}</h2>
            {c.food.shortageKcal <= 0 && c.water.shortageLitres <= 0 ? (
              <p><Badge tone="ok">{t('status.met')}</Badge> {t('dash.noShortage')}</p>
            ) : (
              <ul className="plain">
                {c.food.shortageKcal > 0 && <li><Badge tone="bad">{t('dash.food')}</Badge> {kcal(c.food.shortageKcal)}</li>}
                {c.water.shortageLitres > 0 && <li><Badge tone="bad">{t('dash.water')}</Badge> {num(c.water.shortageLitres)} L</li>}
              </ul>
            )}
          </section>

          <section className="card">
            <h2>{t('dash.macros')}</h2>
            <div className="table-wrap">
              <table>
                <thead><tr><th scope="col">{t('dash.nutrient')}</th><th scope="col">{t('dash.available')}</th><th scope="col">{t('dash.optionalTarget', { n: target })}</th></tr></thead>
                <tbody>
                  <tr><th scope="row">{t('f.kcal')}</th><td>{kcal(c.food.kcal)}</td><td>{kcal(c.food.dailyKcal * target)}</td></tr>
                  {macroRow('carbs', 'f.carbs')}{macroRow('protein', 'f.protein')}{macroRow('fat', 'f.fat')}
                </tbody>
              </table>
            </div>
            {c.food.macrosIncomplete > 0 && <p className="hint">{t('dash.macrosIncomplete', { n: c.food.macrosIncomplete })}</p>}
            <p className="hint">{t('dash.macroNote')}</p>
          </section>

          <section className="card" aria-live="polite">
            <h2>{t('dash.uncertainty')}</h2>
            <ul className="plain">
              {c.food.estimatedShare > 0 && <li><Badge tone="warn">{t('status.estimate')}</Badge> {t('dash.estimatedShare', { pct: Math.round(c.food.estimatedShare * 100) })}</li>}
              {c.missingNutrition.length > 0 && <li><Badge tone="warn">{t('status.missing')}</Badge> {t('dash.missingNutrition', { n: c.missingNutrition.length })}: {c.missingNutrition.map((m: any) => `${m.productName} (${t(`miss.${m.reason}` as MsgKey)})`).join(', ')}. <a href="#/inventory">{t('dash.fixInventory')}</a></li>}
              {c.waterMissingVolume.length > 0 && <li><Badge tone="warn">{t('status.missing')}</Badge> {t('dash.waterVolumeMissing', { n: c.waterMissingVolume.length })}</li>}
              {c.unknownExpiryCount > 0 && <li><Badge tone="muted">{t('status.unknown')}</Badge> {t('dash.unknownExpiry', { n: c.unknownExpiryCount })}</li>}
              {c.food.estimatedShare === 0 && c.missingNutrition.length === 0 && c.waterMissingVolume.length === 0 && c.unknownExpiryCount === 0 && <li>{t('dash.noUncertainty')}</li>}
            </ul>
            <p className="hint">{t('dash.disclaimer')}</p>
          </section>

          <section className="card">
            <h2>{t('dash.upcoming')}</h2>
            {c.dueSoon.length === 0 ? <p>{t('dash.nothingDue', { n: data.household.reminderDays })}</p> : (
              <ul className="plain">{c.dueSoon.slice(0, 8).map((d: any) => (
                <li key={d.batchId}><Badge tone="warn">{t('status.due')}</Badge> <strong>{d.productName}</strong> – {date(d.expiryDate)}</li>
              ))}</ul>
            )}
            {c.expiredUseBy.length > 0 && (
              <>
                <h3>{t('dash.expiredUseBy')}</h3>
                <p className="hint">{t('dash.expiredUseByHint')}</p>
                <ul className="plain">{c.expiredUseBy.map((d: any) => <li key={d.batchId}><Badge tone="bad">{t('status.expired_tgt')}</Badge> {d.productName} – {date(d.expiryDate)}</li>)}</ul>
              </>
            )}
            {c.expiredBestBefore.length > 0 && (
              <>
                <h3>{t('dash.expiredBestBefore')}</h3>
                <p className="hint">{t('dash.expiredBestBeforeHint')}</p>
                <ul className="plain">{c.expiredBestBefore.map((d: any) => <li key={d.batchId}><Badge tone="warn">{t('status.expired_tht')}</Badge> {d.productName} – {date(d.expiryDate)}{d.kcal !== null && <> ({kcal(d.kcal)} {t('dash.notCounted')})</>}</li>)}</ul>
              </>
            )}
            <p><a href="#/expiry">{t('dash.allExpiry')}</a></p>
          </section>
        </>
      )}
      {adding && <ProductForm onClose={() => setAdding(false)} onSaved={reload} />}
    </>
  );
}
