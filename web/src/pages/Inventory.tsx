import { useMemo, useState } from 'react';
import { del, get, post, put } from '../api';
import type { User } from '../App';
import { ImportModal } from '../components/ImportModal';
import { CATEGORIES, ProductForm, UNITS } from '../components/ProductForm';
import { useI18n, type MsgKey } from '../i18n';
import { Badge, ConfirmButton, Empty, ErrorBox, Field, Loading, Modal, download, toast, useFormErrors, useLoad, type Tone } from '../ui';

const statusTone: Record<string, Tone> = { ok: 'ok', due: 'warn', expired_tht: 'warn', expired_tgt: 'bad', unknown: 'muted' };
const baseOf = (u: string) => (u === 'kg' ? 'g' : u === 'l' ? 'ml' : u);

function useDisplay() {
  const { t, num } = useI18n();
  return (amount: number, unit: string) => `${num(amount, 2)} ${t(`unit.${unit}` as MsgKey)}`;
}

export function Inventory({ user }: { user: User }) {
  const { t, num, date, lang } = useI18n();
  const show = useDisplay();
  const { data, error, reload } = useLoad(() => get('/products'));
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [location, setLocation] = useState('');
  const [expiry, setExpiry] = useState('');
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [form, setForm] = useState<{ kind: 'new' | 'edit'; product?: any } | null>(null);
  const [addStock, setAddStock] = useState<any>(null);
  const [consume, setConsume] = useState<any>(null);
  const [correct, setCorrect] = useState<any>(null);
  const [importing, setImporting] = useState(false);

  const products: any[] = data?.products ?? [];
  const locations = useMemo(() => [...new Set(products.map((p) => p.location).filter(Boolean))].sort(), [products]);
  const filtered = products.filter((p) => {
    const text = `${p.name} ${p.brand ?? ''} ${p.barcode ?? ''} ${p.location ?? ''} ${p.catalogueNameEn ?? ''} ${p.catalogueNameNl ?? ''}`.toLowerCase();
    if (q && !text.includes(q.toLowerCase())) return false;
    if (category && p.category !== category) return false;
    if (location && p.location !== location) return false;
    if (expiry === 'due' && !p.batches.some((b: any) => b.status === 'due')) return false;
    if (expiry === 'expired' && !p.batches.some((b: any) => b.status.startsWith('expired'))) return false;
    if (expiry === 'unknown' && !p.batches.some((b: any) => b.status === 'unknown')) return false;
    if (expiry === 'missing' && p.nutritionSource !== 'missing' && !p.batches.some((b: any) => b.missing)) return false;
    if (expiry === 'empty' && p.totalBase > 0) return false;
    return true;
  });
  const toggle = (id: number) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const rm = async (path: string) => { await del(path); toast(t('common.deleted')); reload(); };
  const nutriBadge = (p: any) => {
    if (p.isWater) return <Badge tone="info">{t('nutri.water')}</Badge>;
    const tone: Tone = p.nutritionSource === 'label' ? 'ok' : p.nutritionSource === 'missing' ? 'bad' : 'warn';
    return <Badge tone={tone}>{t(`nutri.${p.nutritionSource}` as MsgKey)}</Badge>;
  };
  void lang;
  if (error) return <p className="alert alert-error" role="alert">{t('err.server_error')}</p>;
  if (!data) return <Loading />;
  return (
    <>
      <div className="page-head">
        <h1>{t('nav.inventory')}</h1>
        <div className="btn-row">
          <button className="btn" onClick={() => download('/inventory/export.csv')}>{t('csv.export')}</button>
          <button className="btn" onClick={() => setImporting(true)}>{t('csv.importBtn')}</button>
          <button className="btn btn-primary btn-lg" onClick={() => setForm({ kind: 'new' })}>＋ {t('product.add')}</button>
        </div>
      </div>
      <div className="toolbar" role="search">
        <div className="field grow"><label htmlFor="inv-q">{t('common.search')}</label><input id="inv-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('inv.searchHint')} /></div>
        <div className="field"><label htmlFor="inv-c">{t('f.category')}</label>
          <select id="inv-c" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">{t('common.all')}</option>{CATEGORIES.map((c) => <option key={c} value={c}>{t(`cat.${c}` as MsgKey)}</option>)}</select></div>
        <div className="field"><label htmlFor="inv-l">{t('f.location')}</label>
          <select id="inv-l" value={location} onChange={(e) => setLocation(e.target.value)}><option value="">{t('common.all')}</option>{locations.map((l) => <option key={l} value={l}>{l}</option>)}</select></div>
        <div className="field"><label htmlFor="inv-e">{t('inv.filter')}</label>
          <select id="inv-e" value={expiry} onChange={(e) => setExpiry(e.target.value)}>
            <option value="">{t('common.all')}</option><option value="due">{t('inv.fDue')}</option><option value="expired">{t('inv.fExpired')}</option>
            <option value="unknown">{t('inv.fUnknown')}</option><option value="missing">{t('inv.fMissing')}</option><option value="empty">{t('inv.fEmpty')}</option>
          </select></div>
      </div>
      <p className="muted" role="status">{t('inv.count', { n: filtered.length, total: products.length })}</p>

      {products.length === 0 ? (
        <Empty title={t('inv.emptyTitle')} text={t('inv.emptyText')} action={<button className="btn btn-primary" onClick={() => setForm({ kind: 'new' })}>{t('product.add')}</button>} />
      ) : filtered.length === 0 ? (
        <Empty title={t('inv.noMatch')} text={t('inv.noMatchText')} />
      ) : (
        <ul className="plain products">
          {filtered.map((p) => {
            const isOpen = open.has(p.id);
            const worst = p.batches.reduce((w: string, b: any) => (['expired_tgt', 'expired_tht', 'due'].includes(b.status) && (w === 'ok' || b.status === 'expired_tgt') ? b.status : w), 'ok');
            return (
              <li key={p.id} className="card product">
                <div className="product-head">
                  <button className="expander" aria-expanded={isOpen} aria-controls={`b${p.id}`} onClick={() => toggle(p.id)}>
                    <span aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                    <span className="product-title"><strong>{p.name}</strong>{p.brand && <span className="muted"> · {p.brand}</span>}</span>
                  </button>
                  <div className="product-meta">
                    <Badge tone="muted">{t(`cat.${p.category}` as MsgKey)}</Badge>
                    {p.location && <Badge tone="muted">{p.location}</Badge>}
                    {nutriBadge(p)}
                    {!p.isWater && p.resolvedPreparation !== 'ready' && <Badge tone="info">{t(`prep.${p.resolvedPreparation}` as MsgKey)}</Badge>}
                    {worst !== 'ok' && <Badge tone={statusTone[worst]}>{t(`status.${worst}` as MsgKey)}</Badge>}
                    {p.isDemo && <Badge tone="info">{t('status.demo')}</Badge>}
                  </div>
                  <div className="product-total"><strong>{p.baseUnit ? show(p.baseUnit === 'g' && p.totalBase >= 1000 ? p.totalBase / 1000 : p.baseUnit === 'ml' && p.totalBase >= 1000 ? p.totalBase / 1000 : p.totalBase, p.baseUnit === 'g' && p.totalBase >= 1000 ? 'kg' : p.baseUnit === 'ml' && p.totalBase >= 1000 ? 'l' : p.baseUnit) : t('inv.noBatches')}</strong></div>
                  <div className="btn-row">
                    <button className="btn btn-lg" onClick={() => setAddStock(p)} aria-label={`${t('inv.addStock')}: ${p.name}`}>＋ {t('inv.addStock')}</button>
                    <button className="btn btn-lg" disabled={!p.baseUnit || p.totalBase <= 0} onClick={() => setConsume(p)} aria-label={`${t('inv.consume')}: ${p.name}`}>－ {t('inv.consume')}</button>
                  </div>
                </div>
                {isOpen && (
                  <div id={`b${p.id}`} className="product-body">
                    {p.batches.length === 0 ? <p className="muted">{t('inv.noBatches')}</p> : (
                      <div className="table-wrap">
                        <table>
                          <caption className="sr-only">{t('inv.batches')}: {p.name}</caption>
                          <thead><tr><th scope="col">{t('inv.remaining')}</th><th scope="col">{t('inv.packageCol')}</th><th scope="col">{t('f.expiryDate')}</th><th scope="col">{t('f.status')}</th><th scope="col">{t('f.kcal')}</th><th scope="col"><span className="sr-only">{t('common.actions')}</span></th></tr></thead>
                          <tbody>
                            {p.batches.map((b: any) => (
                              <tr key={b.id}>
                                <td>{show(b.remaining, b.unit)}</td>
                                <td>{num(b.remainingPackages, 2)} × {show(b.packageSize, b.unit)}</td>
                                <td>{b.expiryDate ? <>{date(b.expiryDate)} <span className="muted">({t(`exp.${b.expiryKind}` as MsgKey)})</span></> : t('exp.unknown')}</td>
                                <td><Badge tone={statusTone[b.status]}>{t(`status.${b.status}` as MsgKey)}</Badge></td>
                                <td>{p.isWater ? '–' : b.missing ? <Badge tone="bad">{t(`miss.${b.missing}` as MsgKey)}</Badge> : num(b.kcal, 0)}</td>
                                <td className="row-actions">
                                  <button className="btn" onClick={() => setCorrect({ product: p, batch: b })}>{t('inv.correct')}</button>
                                  <ConfirmButton label={t('common.delete')} confirm={t('inv.confirmDeleteBatch')} onConfirm={() => rm(`/batches/${b.id}`)} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <div className="btn-row">
                      <button className="btn" onClick={() => setForm({ kind: 'edit', product: p })}>{t('common.edit')}</button>
                      <ConfirmButton label={t('inv.deleteProduct')} confirm={t('inv.confirmDeleteProduct', { name: p.name })} onConfirm={() => rm(`/products/${p.id}`)} />
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {form && <ProductForm product={form.product} onClose={() => setForm(null)} onSaved={reload} />}
      {addStock && <StockForm product={addStock} onClose={() => setAddStock(null)} onSaved={reload} />}
      {consume && <ConsumeForm product={consume} onClose={() => setConsume(null)} onSaved={reload} />}
      {correct && <CorrectForm {...correct} onClose={() => setCorrect(null)} onSaved={reload} />}
      {importing && <ImportModal title={t('csv.importInventory')} endpoint="/inventory/import" templateHref="/api/inventory/template.csv" onClose={() => setImporting(false)} onDone={reload}
        describe={(r) => `${r.product.name}: ${r.batch.packages} × ${r.batch.packageSize} ${r.batch.unit}${r.batch.expiryDate ? `, ${date(r.batch.expiryDate)}` : ''}`} />}
      <span hidden>{user.id}</span>
    </>
  );
}

const nz = (v: string) => (v.trim() === '' ? undefined : Number(v.replace(',', '.')));

function StockForm({ product, onClose, onSaved }: { product: any; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const fe = useFormErrors();
  const last = product.batches.at(-1);
  const [f, setF] = useState({ packages: '1', packageSize: String(last?.packageSize ?? ''), unit: last?.unit ?? 'g', remaining: '', expiryKind: last?.expiryKind === 'tgt' ? 'tgt' : 'tht', expiryDate: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const allowed = product.baseUnit ? UNITS.filter((u) => baseOf(u) === product.baseUnit) : UNITS;
  async function submit(e: React.FormEvent) {
    e.preventDefault(); fe.clear();
    try {
      await post(`/products/${product.id}/batches`, { packages: nz(f.packages), packageSize: nz(f.packageSize), unit: f.unit, remaining: nz(f.remaining), expiryDate: f.expiryDate || null, expiryKind: f.expiryDate ? f.expiryKind : 'unknown' });
      toast(t('inv.stockAdded')); onSaved(); onClose();
    } catch (x) { fe.fail(x); }
  }
  const E = (k: string) => fe.fieldErrors[k] ?? null;
  return (
    <Modal title={`${t('inv.addStock')}: ${product.name}`} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <ErrorBox message={fe.formError} />
        <div className="grid-3">
          <Field label={t('f.packages')} error={E('packages')}>{(p) => <input {...p} inputMode="decimal" value={f.packages} onChange={set('packages')} autoFocus />}</Field>
          <Field label={t('f.packageSize')} error={E('packageSize')}>{(p) => <input {...p} inputMode="decimal" value={f.packageSize} onChange={set('packageSize')} />}</Field>
          <Field label={t('f.unit')} error={E('unit')}>{(p) => <select {...p} value={f.unit} onChange={set('unit')}>{allowed.map((u) => <option key={u} value={u}>{t(`unit.${u}` as MsgKey)}</option>)}</select>}</Field>
        </div>
        <Field label={t('f.remaining')} error={E('remaining')} hint={t('product.remainingHint')}>{(p) => <input {...p} inputMode="decimal" value={f.remaining} onChange={set('remaining')} />}</Field>
        <div className="grid-2">
          <Field label={t('f.expiryKind')}>{(p) => <select {...p} value={f.expiryKind} onChange={set('expiryKind')}><option value="tht">{t('exp.tht')}</option><option value="tgt">{t('exp.tgt')}</option></select>}</Field>
          <Field label={t('f.expiryDate')} error={E('expiryDate')} hint={t('product.expiryHint')}>{(p) => <input {...p} type="date" value={f.expiryDate} onChange={set('expiryDate')} />}</Field>
        </div>
        <div className="actions"><button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn btn-primary">{t('common.save')}</button></div>
      </form>
    </Modal>
  );
}

function ConsumeForm({ product, onClose, onSaved }: { product: any; onClose: () => void; onSaved: () => void }) {
  const { t, num, date } = useI18n();
  const show = useDisplay();
  const fe = useFormErrors();
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState<string>(product.baseUnit === 'piece' ? 'piece' : product.baseUnit);
  const [preview, setPreview] = useState<any[] | null>(null);
  const units = UNITS.filter((u) => baseOf(u) === product.baseUnit);
  const byId = new Map<number, any>(product.batches.map((b: any) => [b.id, b]));
  async function run(dryRun: boolean) {
    fe.clear();
    try {
      const r = await post(`/products/${product.id}/consume`, { amount: nz(amount), unit, dryRun });
      if (dryRun) setPreview(r.allocation);
      else { toast(t('inv.consumed')); onSaved(); onClose(); }
    } catch (x) { setPreview(null); fe.fail(x); }
  }
  return (
    <Modal title={`${t('inv.consume')}: ${product.name}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); run(true); }} noValidate>
        <ErrorBox message={fe.formError} />
        <p className="muted">{t('inv.consumeHint')}</p>
        <div className="grid-2">
          <Field label={t('f.amount')} error={fe.fieldErrors.amount ?? null}>{(p) => <input {...p} inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setPreview(null); }} autoFocus />}</Field>
          <Field label={t('f.unit')}>{(p) => <select {...p} value={unit} onChange={(e) => { setUnit(e.target.value); setPreview(null); }}>{units.map((u) => <option key={u} value={u}>{t(`unit.${u}` as MsgKey)}</option>)}</select>}</Field>
        </div>
        {preview && (
          <div className="alert alert-info" role="status">
            <strong>{t('inv.willUse')}</strong>
            <ul className="plain">{preview.map((a) => {
              const b = byId.get(a.batchId);
              return <li key={a.batchId}>{show(a.amountBase, b ? baseOf(b.unit) : product.baseUnit)} – {b?.expiryDate ? date(b.expiryDate) : t('exp.unknown')}</li>;
            })}</ul>
          </div>
        )}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
          {!preview ? <button className="btn btn-primary">{t('inv.suggest')}</button> : <button type="button" className="btn btn-primary" onClick={() => run(false)}>{t('inv.confirmConsume')}</button>}
        </div>
      </form>
      <span hidden>{num(0)}</span>
    </Modal>
  );
}

function CorrectForm({ product, batch, onClose, onSaved }: { product: any; batch: any; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const fe = useFormErrors();
  const [f, setF] = useState({ remaining: String(batch.remaining), packages: String(batch.packages), packageSize: String(batch.packageSize), expiryKind: batch.expiryKind === 'unknown' ? 'tht' : batch.expiryKind, expiryDate: batch.expiryDate ?? '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function submit(e: React.FormEvent) {
    e.preventDefault(); fe.clear();
    try {
      await put(`/batches/${batch.id}`, { remaining: nz(f.remaining), packages: nz(f.packages), packageSize: nz(f.packageSize), expiryDate: f.expiryDate || null, expiryKind: f.expiryDate ? f.expiryKind : 'unknown' });
      toast(t('product.saved')); onSaved(); onClose();
    } catch (x) { fe.fail(x); }
  }
  const E = (k: string) => fe.fieldErrors[k] ?? null;
  return (
    <Modal title={`${t('inv.correct')}: ${product.name}`} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <ErrorBox message={fe.formError} />
        <p className="muted">{t('inv.correctHint', { unit: t(`unit.${batch.unit}` as MsgKey) })}</p>
        <div className="grid-3">
          <Field label={t('inv.remaining')} error={E('remaining')}>{(p) => <input {...p} inputMode="decimal" value={f.remaining} onChange={set('remaining')} autoFocus />}</Field>
          <Field label={t('f.packages')} error={E('packages')}>{(p) => <input {...p} inputMode="decimal" value={f.packages} onChange={set('packages')} />}</Field>
          <Field label={t('f.packageSize')} error={E('packageSize')}>{(p) => <input {...p} inputMode="decimal" value={f.packageSize} onChange={set('packageSize')} />}</Field>
        </div>
        <div className="grid-2">
          <Field label={t('f.expiryKind')}>{(p) => <select {...p} value={f.expiryKind} onChange={set('expiryKind')}><option value="tht">{t('exp.tht')}</option><option value="tgt">{t('exp.tgt')}</option></select>}</Field>
          <Field label={t('f.expiryDate')} error={E('expiryDate')} hint={t('product.expiryHint')}>{(p) => <input {...p} type="date" value={f.expiryDate} onChange={set('expiryDate')} />}</Field>
        </div>
        <div className="actions"><button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn btn-primary">{t('common.save')}</button></div>
      </form>
    </Modal>
  );
}
