import { useEffect, useState } from 'react';
import { del, get, post, put } from '../api';
import type { User } from '../App';
import { useCatalogue } from '../components/ProductForm';
import { useI18n, type MsgKey } from '../i18n';
import { Badge, ConfirmButton, Empty, ErrorBox, Field, Loading, Meter, Modal, toast, useFormErrors, useLoad } from '../ui';

const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;

function useAmount() {
  const { num, t } = useI18n();
  return (v: number, baseUnit: string) => {
    if (baseUnit === 'piece') return `${num(v, v % 1 ? 1 : 0)} ${t('unit.piece')}`;
    if (v >= 1000) return `${num(v / 1000, 2)} ${baseUnit === 'g' ? 'kg' : 'L'}`;
    return `${num(v, 0)} ${baseUnit}`;
  };
}

export function Plan({ user }: { user: User }) {
  const { t, num, kcal, weekday } = useI18n();
  const amount = useAmount();
  const { data, error, reload, setData } = useLoad(() => get('/plan'));
  const house = useLoad(() => get('/household'));
  const [opts, setOpts] = useState<{ startDate: string; days: string; facilities: string; readyOnly: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [editing, setEditing] = useState<any>(null);
  const { err } = useI18n();

  useEffect(() => {
    if (!data || !house.data || opts) return;
    const p = data.plan;
    setOpts({ startDate: p?.params.startDate ?? data.today, days: String(p?.params.days ?? house.data.settings.targetDays), facilities: p?.params.facilities ?? 'stove', readyOnly: p?.params.readyOnly ?? false });
  }, [data, house.data, opts]);

  if (error) return <p className="alert alert-error" role="alert">{t('err.server_error')}</p>;
  if (!data || !house.data || !opts) return <Loading />;
  const plan = data.plan;
  const noMembers = house.data.members.length === 0;

  const apply = (p: any) => setData({ ...data, plan: p });
  async function run<T>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> {
    setBusy(true); setFormError(null);
    try { const r = await fn(); if (ok) toast(ok); return r; }
    catch (e: any) { setFormError(err(e.code ?? 'server_error', e.params)); }
    finally { setBusy(false); }
  }
  const generate = (keepLocked: boolean) => run(async () => {
    const r = await post('/plan/generate', { startDate: opts.startDate, days: Number(opts.days), facilities: opts.facilities, readyOnly: opts.readyOnly, keepLocked });
    apply(r.plan);
  }, t('plan.generated'));

  return (
    <>
      <div className="page-head no-print">
        <h1>{t('nav.plan')}</h1>
        {plan && <div className="btn-row">
          <button className="btn" onClick={() => window.print()}>{t('plan.print')}</button>
          <ConfirmButton label={t('plan.delete')} confirm={t('plan.confirmDelete')} onConfirm={async () => { await del('/plan'); reload(); }} />
        </div>}
      </div>
      <p className="no-print">{t('plan.intro')}</p>
      <div className="alert alert-info no-print">{t('plan.disclaimer')}</div>
      {noMembers && <div className="alert alert-warn">{t('dash.noMembers')} {user.role === 'admin' && <a href="#/settings">{t('dash.addMembers')}</a>}</div>}

      <form className="card no-print" onSubmit={(e) => { e.preventDefault(); generate(true); }}>
        <h2>{t('plan.options')}</h2>
        <ErrorBox message={formError} />
        <div className="grid-4">
          <Field label={t('plan.startDate')}>{(p) => <input {...p} type="date" value={opts.startDate} onChange={(e) => setOpts({ ...opts, startDate: e.target.value })} required />}</Field>
          <Field label={t('plan.days')}>{(p) => <input {...p} type="number" min={1} max={60} value={opts.days} onChange={(e) => setOpts({ ...opts, days: e.target.value })} required />}</Field>
          <Field label={t('plan.facilities')} hint={t('plan.facilitiesHint')}>{(p) => (
            <select {...p} value={opts.facilities} onChange={(e) => setOpts({ ...opts, facilities: e.target.value })}>
              <option value="none">{t('fac.none')}</option><option value="kettle">{t('fac.kettle')}</option><option value="stove">{t('fac.stove')}</option>
            </select>)}</Field>
          <div className="field check-field"><label><input type="checkbox" checked={opts.readyOnly} onChange={(e) => setOpts({ ...opts, readyOnly: e.target.checked })} /> {t('plan.readyOnly')}</label><div className="hint">{t('plan.readyOnlyHint')}</div></div>
        </div>
        <div className="btn-row">
          <button className="btn btn-primary btn-lg" disabled={busy || noMembers}>{plan ? t('plan.regenerate') : t('plan.generate')}</button>
          {plan && <button type="button" className="btn btn-lg" disabled={busy || noMembers} onClick={() => generate(false)}>{t('plan.regenerateAll')}</button>}
        </div>
        <p className="hint">{t('plan.keepLockedHint')}</p>
      </form>

      {!plan ? <Empty title={t('plan.emptyTitle')} text={t('plan.emptyText')} /> : (
        <>
          {plan.stale && (
            <div className="alert alert-warn no-print" role="status">
              <strong>{t('plan.stale')}</strong> {t('plan.staleText')}{' '}
              <button className="btn" disabled={busy} onClick={() => generate(true)}>{t('plan.recalculate')}</button>
            </div>
          )}
          {plan.conflicts.length > 0 && (
            <div className="alert alert-error" role="alert">
              <strong>{t('plan.conflicts')}</strong>
              <ul className="plain">{plan.conflicts.map((c: any) => <li key={c.batchId}>{plan.batchInfo[c.batchId]?.productName ?? `#${c.batchId}`}: {t('plan.reservedVsStock', { reserved: amount(c.reserved, plan.batchInfo[c.batchId]?.baseUnit ?? 'g'), stock: amount(c.remaining, plan.batchInfo[c.batchId]?.baseUnit ?? 'g') })}</li>)}</ul>
            </div>
          )}
          <Summary plan={plan} />
          {plan.days.map((d: any) => <DayCard key={d.dayIndex} day={d} plan={plan} busy={busy} amount={amount}
            onEdit={(m: any) => setEditing(m)}
            onLock={(m: any) => run(async () => apply((await post(`/plan/meals/${m.id}/lock`, { locked: !m.locked })).plan))}
            onConsume={(m: any) => run(async () => apply((await post(`/plan/meals/${m.id}/consume`)).plan), t('plan.consumed'))} />)}
          <Shopping plan={plan} />
        </>
      )}
      {editing && plan && <MealEditor meal={editing} plan={plan} amount={amount} onClose={() => setEditing(null)} onSaved={(p) => { apply(p); toast(t('plan.mealSaved')); }} />}
      <span hidden>{num(0)}{kcal(0)}{weekday('2026-01-01')}</span>
    </>
  );
}

function Summary({ plan }: { plan: any }) {
  const { t, kcal, num, date } = useI18n();
  const tot = plan.totals;
  const short = plan.days.filter((d: any) => d.shortKcal > 0.5 || d.waterShortMl > 0.5);
  const kcalShort = tot.shortKcal > tot.targetKcal * 0.02;
  return (
    <section className="card plan-summary" aria-label={t('plan.summary')}>
      <h2>{t('plan.summary')} <span className="muted small">({date(plan.params.startDate)} – {date(plan.endDate)})</span></h2>
      <dl className="kv">
        <dt>{t('plan.plannedKcal')}</dt><dd>{kcal(tot.kcal)} / {kcal(tot.targetKcal)}</dd>
        <dt>{t('dash.shortage')}</dt><dd className={tot.shortKcal > 0.5 ? 'text-bad' : 'text-ok'}>{tot.shortKcal > 0.5 ? kcal(tot.shortKcal) : t('dash.none')}</dd>
        <dt>{t('plan.waterShort')}</dt><dd className={tot.waterShortMl > 0.5 ? 'text-bad' : 'text-ok'}>{tot.waterShortMl > 0.5 ? `${num(tot.waterShortMl / 1000)} L` : t('dash.none')}</dd>
      </dl>
      {short.length === 0 ? <p><Badge tone="ok">{t('status.met')}</Badge> {t('plan.allCovered')}</p> : (
        <div role="alert">
          <p><Badge tone="bad">{kcalShort || tot.waterShortMl > 0.5 ? t('status.short') : t('status.partial')}</Badge> <strong>{t('plan.shortfallTitle')}</strong></p>
          <ul>{short.map((d: any) => (
            <li key={d.dayIndex}>
              {t('plan.dayN', { n: d.dayIndex + 1 })} ({date(d.date)}):{' '}
              {d.shortKcal > 0.5 && <>{t('plan.kcalShortFor', { kcal: Math.round(d.shortKcal), names: d.members.filter((m: any) => m.shortKcal > 0.5).map((m: any) => `${m.name} ${Math.round(m.shortKcal)}`).join(', ') })}. </>}
              {d.waterShortMl > 0.5 && <>{t('plan.waterShortDay', { l: num(d.waterShortMl / 1000) })}.</>}
            </li>))}
          </ul>
        </div>
      )}
      <p className="hint">{t('dash.disclaimer')}</p>
    </section>
  );
}

function DayCard({ day, plan, amount, busy, onEdit, onLock, onConsume }: any) {
  const { t, kcal, num, weekday, lang } = useI18n();
  const meals = plan.meals.filter((m: any) => m.dayIndex === day.dayIndex);
  const kt = day.shortKcal > 0.5 ? 'bad' : 'ok';
  const members: any[] = plan.members;
  return (
    <section className="card day" aria-labelledby={`d${day.dayIndex}`}>
      <h2 id={`d${day.dayIndex}`}>{t('plan.dayN', { n: day.dayIndex + 1 })} · {weekday(day.date)}</h2>
      <div className="day-stats">
        <div><span className="muted">{t('f.kcal')}</span> <strong>{kcal(day.kcal)}</strong> / {kcal(day.targetKcal)} <Badge tone={kt}>{day.shortKcal > 0.5 ? t('plan.shortBy', { n: Math.round(day.shortKcal) }) : t('status.met')}</Badge>
          <Meter value={day.kcal} max={day.targetKcal} tone={kt} label={`${kcal(day.kcal)} / ${kcal(day.targetKcal)}`} /></div>
        <div><span className="muted">{t('f.carbs')} / {t('f.protein')} / {t('f.fat')}</span> <strong>{num(day.carbs, 0)} / {num(day.protein, 0)} / {num(day.fat, 0)} g</strong></div>
        <div><span className="muted">{t('plan.drinking')}</span> <strong>{num(day.drinkingAllocatedMl / 1000)}</strong> / {num(day.drinkingTargetMl / 1000)} L{' '}
          <span className="muted">+ {t('plan.prepWater')} {num(day.prepWaterMl / 1000)} L</span>{' '}
          <Badge tone={day.waterShortMl > 0.5 ? 'bad' : 'ok'}>{day.waterShortMl > 0.5 ? t('plan.shortBy', { n: `${num(day.waterShortMl / 1000)} L` }) : t('status.met')}</Badge></div>
      </div>
      <div className="table-wrap">
        <table className="compact">
          <caption className="sr-only">{t('plan.perPerson')}</caption>
          <thead><tr><th scope="col">{t('plan.person')}</th><th scope="col" className="num">{t('plan.target')}</th><th scope="col" className="num">{t('plan.planned')}</th><th scope="col" className="num">{t('dash.shortage')}</th></tr></thead>
          <tbody>{day.members.map((m: any) => <tr key={m.memberId}><th scope="row">{m.name}</th><td className="num">{kcal(m.targetKcal)}</td><td className="num">{kcal(m.kcal)}</td>
            <td className={`num ${m.shortKcal > 0.5 ? 'text-bad' : ''}`}>{m.shortKcal > 0.5 ? kcal(m.shortKcal) : '–'}</td></tr>)}</tbody>
        </table>
      </div>
      {SLOTS.map((slot) => {
        const m = meals.find((x: any) => x.slot === slot);
        if (!m) return null;
        const title = (lang === 'nl' ? m.templateNameNl : m.templateNameEn);
        return (
          <article key={slot} className={`meal${m.consumed ? ' meal-done' : ''}`} aria-label={t(`slot.${slot}` as MsgKey)}>
            <header>
              <h3>{t(`slot.${slot}` as MsgKey)}{title && <span className="muted"> · {title}</span>}</h3>
              <div className="meal-badges">
                <span>{kcal(m.kcal)} / {kcal(m.targetKcal)}</span>
                {m.consumed && <Badge tone="ok">{t('plan.isConsumed')}</Badge>}
                {m.locked && !m.consumed && <Badge tone="info">{t('plan.locked')}</Badge>}
              </div>
              {!m.consumed && (
                <div className="btn-row no-print">
                  <button className="btn" disabled={busy} onClick={() => onEdit(m)}>{t('common.edit')}</button>
                  <button className="btn" disabled={busy} onClick={() => onLock(m)} aria-pressed={m.locked}>{m.locked ? t('plan.unlock') : t('plan.lock')}</button>
                  <button className="btn btn-primary" disabled={busy || m.items.length === 0 || m.items.some((i: any) => i.problems.length > 0)} onClick={() => onConsume(m)}>{t('plan.markConsumed')}</button>
                </div>
              )}
            </header>
            {m.items.length === 0 ? <p className="muted">{m.consumed ? t('plan.consumedEmpty') : t('plan.noFood')}</p> : (
              <div className="table-wrap">
                <table className="compact">
                  <thead><tr><th scope="col">{t('f.name')}</th><th scope="col" className="num">{t('plan.household')}</th>
                    {members.map((mm: any) => <th scope="col" className="num" key={mm.id}>{mm.name}</th>)}<th scope="col" className="num">kcal</th></tr></thead>
                  <tbody>{m.items.map((i: any) => {
                    const info = plan.batchInfo[i.batchId];
                    return (
                      <tr key={i.batchId}>
                        <th scope="row">{info?.productName ?? `#${i.batchId}`}{info?.expiryDate && <div className="muted small">{t('plan.expires')} {info.expiryDate}</div>}
                          {i.problems.map((p: string) => <div key={p} className="text-bad small" role="alert">⚠ {t(`prob.${p}` as MsgKey)}</div>)}</th>
                        <td className="num">{amount(i.amount, info?.baseUnit ?? 'g')}</td>
                        {i.perMember.map((pm: any) => <td className="num" key={pm.memberId}>{amount(info?.baseUnit === 'piece' ? Math.round(pm.amount * 10) / 10 : Math.round(pm.amount), info?.baseUnit ?? 'g')}</td>)}
                        <td className="num">{i.kcal === null ? '–' : num(i.kcal, 0)}</td>
                      </tr>);
                  })}</tbody>
                </table>
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}

function MealEditor({ meal, plan, amount, onClose, onSaved }: { meal: any; plan: any; amount: (v: number, u: string) => string; onClose: () => void; onSaved: (p: any) => void }) {
  const { t } = useI18n();
  const fe = useFormErrors();
  const [rows, setRows] = useState<{ batchId: string; amount: string }[]>(meal.items.map((i: any) => ({ batchId: String(i.batchId), amount: String(Math.round(i.amount * 100) / 100) })));
  const batches = Object.entries(plan.batchInfo as Record<string, any>).filter(([, b]) => b.remaining > 0).sort((a, b) => a[1].productName.localeCompare(b[1].productName));
  const reservedElsewhere = (id: number) => plan.meals.filter((m: any) => m.id !== meal.id && !m.consumed).reduce((s: number, m: any) => s + m.items.filter((i: any) => i.batchId === id).reduce((x: number, i: any) => x + i.amount, 0), 0);
  async function save(e: React.FormEvent) {
    e.preventDefault(); fe.clear();
    try {
      const r = await put(`/plan/meals/${meal.id}`, { items: rows.filter((r) => r.batchId && r.amount).map((r) => ({ batchId: Number(r.batchId), amount: Number(r.amount.replace(',', '.')) })) });
      onSaved(r.plan); onClose();
    } catch (x) { fe.fail(x); }
  }
  return (
    <Modal title={`${t('plan.editMeal')}: ${t(`slot.${meal.slot}` as MsgKey)}`} onClose={onClose} wide>
      <form onSubmit={save} noValidate>
        <ErrorBox message={fe.formError} />
        <p className="muted">{t('plan.editHint')}</p>
        {rows.map((r, idx) => {
          const info = plan.batchInfo[r.batchId];
          const free = info ? info.remaining - reservedElsewhere(Number(r.batchId)) : 0;
          const over = info && Number(r.amount.replace(',', '.')) > free + 1e-6;
          return (
            <div className="grid-edit" key={idx}>
              <Field label={t('plan.ingredient')}>{(p) => (
                <select {...p} value={r.batchId} onChange={(e) => setRows(rows.map((x, i) => (i === idx ? { ...x, batchId: e.target.value } : x)))}>
                  <option value="">–</option>
                  {batches.map(([id, b]) => <option key={id} value={id}>{b.productName}{b.expiryDate ? ` (${b.expiryDate})` : ''} – {amount(b.remaining, b.baseUnit)}</option>)}
                </select>)}</Field>
              <Field label={`${t('f.amount')}${info ? ` (${info.baseUnit === 'piece' ? t('unit.piece') : info.baseUnit})` : ''}`} error={over ? t('plan.exceedsStock', { free: amount(Math.max(0, free), info.baseUnit) }) : null}>{(p) => (
                <input {...p} inputMode="decimal" value={r.amount} onChange={(e) => setRows(rows.map((x, i) => (i === idx ? { ...x, amount: e.target.value } : x)))} />)}</Field>
              <button type="button" className="btn" onClick={() => setRows(rows.filter((_, i) => i !== idx))} aria-label={t('common.delete')}>✕</button>
            </div>
          );
        })}
        <button type="button" className="btn" onClick={() => setRows([...rows, { batchId: '', amount: '' }])}>＋ {t('plan.addIngredient')}</button>
        <div className="actions"><button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn btn-primary">{t('plan.saveMeal')}</button></div>
      </form>
    </Modal>
  );
}

function Shopping({ plan }: { plan: any }) {
  const { t, kcal, num, date } = useI18n();
  const cat = useCatalogue();
  const [foodId, setFoodId] = useState('');
  const [bottle, setBottle] = useState('1.5');
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const { err } = useI18n();
  const key = `${plan.generatedAt}|${foodId}|${bottle}|${plan.totals.shortKcal}|${plan.totals.waterShortMl}`;
  useEffect(() => {
    const qs = new URLSearchParams();
    if (foodId) qs.set('foodCatalogueId', foodId);
    if (bottle) qs.set('bottleL', bottle.replace(',', '.'));
    get(`/plan/shopping?${qs}`).then((d) => { setData(d); setError(null); }).catch((e) => { setError(err(e.code ?? 'server_error', e.params)); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const none = data && data.shortKcal <= 0.5 && data.waterShortL <= 0.0005;
  return (
    <section className="card" aria-labelledby="shop">
      <h2 id="shop">{t('plan.shopping')}</h2>
      <p className="hint no-print">{t('plan.shoppingHint')}</p>
      <ErrorBox message={error} />
      <div className="grid-2 no-print">
        <Field label={t('plan.refFood')} hint={t('plan.refFoodHint')}>{(p) => (
          <select {...p} value={foodId} onChange={(e) => setFoodId(e.target.value)}>
            <option value="">{t('plan.noRef')}</option>
            {cat.items.filter((c) => c.weightBasis !== 'drained').map((c) => <option key={c.id} value={c.id}>{cat.name(c)}</option>)}
          </select>)}</Field>
        <Field label={t('plan.bottleSize')}>{(p) => <input {...p} inputMode="decimal" value={bottle} onChange={(e) => setBottle(e.target.value)} />}</Field>
      </div>
      {!data ? null : none ? <p><Badge tone="ok">{t('status.met')}</Badge> {t('plan.nothingToBuy')}</p> : (
        <>
          <ul>
            {data.shortKcal > 0.5 && <li><strong>{t('dash.food')}:</strong> {kcal(data.shortKcal)}{data.food && <> ≈ <strong>{num(data.food.amount, 0)} {data.food.unit}</strong> {data.food.name} ({t('plan.estimateQty')})</>}</li>}
            {data.waterShortL > 0.0005 && <li><strong>{t('dash.water')}:</strong> {num(data.waterShortL)} L{data.water && <> ≈ <strong>{data.water.bottles} × {num(data.water.bottleL)} L</strong></>}</li>}
          </ul>
          <div className="table-wrap"><table className="compact">
            <thead><tr><th scope="col">{t('plan.day')}</th><th scope="col" className="num">{t('dash.shortage')} kcal</th><th scope="col">{t('plan.person')}</th><th scope="col" className="num">{t('dash.water')} L</th></tr></thead>
            <tbody>{data.days.map((d: any) => <tr key={d.dayIndex}><th scope="row">{date(d.date)}</th><td className="num">{num(d.shortKcal, 0)}</td>
              <td>{d.members.map((m: any) => `${m.name} ${Math.round(m.shortKcal)}`).join(', ') || '–'}</td><td className="num">{num(d.waterShortMl / 1000)}</td></tr>)}</tbody>
          </table></div>
        </>
      )}
      <button className="btn no-print" onClick={() => window.print()}>{t('plan.print')}</button>
    </section>
  );
}
