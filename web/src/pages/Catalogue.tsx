import { useState } from 'react';
import { del, post, put } from '../api';
import type { User } from '../App';
import { ImportModal } from '../components/ImportModal';
import { CATEGORIES, FOOD_GROUPS, useCatalogue, type CatalogueItem } from '../components/ProductForm';
import { useI18n, type MsgKey } from '../i18n';
import { Badge, ConfirmButton, Empty, ErrorBox, Field, Loading, Modal, download, toast, useFormErrors } from '../ui';

const nz = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export function Catalogue({ user }: { user: User }) {
  const { t, num } = useI18n();
  const cat = useCatalogue();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [edit, setEdit] = useState<Partial<CatalogueItem> | null>(null);
  const [importing, setImporting] = useState(false);
  if (!cat.loaded) return <Loading />;
  const items = cat.items.filter((c) => (!category || c.category === category) && (!q || `${c.nameNl} ${c.nameEn}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <>
      <div className="page-head">
        <h1>{t('nav.catalogue')}</h1>
        <div className="btn-row">
          <button className="btn" onClick={() => download('/catalogue.csv')}>{t('csv.export')}</button>
          <button className="btn" onClick={() => setImporting(true)}>{t('csv.importBtn')}</button>
          <button className="btn btn-primary btn-lg" onClick={() => setEdit({})}>＋ {t('cat.add')}</button>
        </div>
      </div>
      <div className="alert alert-info">{t('cat.intro')} <a href="#/settings">{t('cat.licences')}</a></div>
      <div className="toolbar" role="search">
        <div className="field grow"><label htmlFor="cq">{t('common.search')}</label><input id="cq" type="search" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="field"><label htmlFor="cc">{t('f.category')}</label>
          <select id="cc" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">{t('common.all')}</option>{CATEGORIES.map((c) => <option key={c} value={c}>{t(`cat.${c}` as MsgKey)}</option>)}</select></div>
      </div>
      {items.length === 0 ? <Empty title={t('cat.empty')} text={t('cat.emptyText')} /> : (
        <div className="table-wrap">
          <table className="catalogue-table">
            <caption className="sr-only">{t('nav.catalogue')}</caption>
            <thead><tr>
              <th scope="col">{t('f.name')}</th><th scope="col">{t('f.category')}</th><th scope="col" className="num">kcal</th>
              <th scope="col" className="num">{t('f.carbs')}</th><th scope="col" className="num">{t('f.protein')}</th><th scope="col" className="num">{t('f.fat')}</th>
              <th scope="col">{t('cat.basis')}</th><th scope="col">{t('cat.provenance')}</th><th scope="col"><span className="sr-only">{t('common.actions')}</span></th>
            </tr></thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <th scope="row"><div>{cat.name(c)}</div><div className="muted small">{cat.name({ nameNl: c.nameEn, nameEn: c.nameNl })}</div></th>
                  <td>{t(`cat.${c.category}` as MsgKey)}</td>
                  <td className="num">{num(c.kcal, 0)}</td><td className="num">{num(c.carbs)}</td><td className="num">{num(c.protein)}</td><td className="num">{num(c.fat)}</td>
                  <td>{t(c.basis === 'g' ? 'product.per100g' : 'product.per100ml')}{c.weightBasis === 'drained' && <> · <Badge tone="info">{t('weight.drained')}</Badge></>}{c.preparation !== 'ready' && <> · <Badge tone="info">{t(`prep.${c.preparation}` as MsgKey)}</Badge></>}</td>
                  <td>{c.isEstimate ? <Badge tone="warn">{t('status.estimate')}</Badge> : <Badge tone="ok">{t('status.verified')}</Badge>} <span className="small muted">{c.source}</span></td>
                  <td className="row-actions">
                    <button className="btn" onClick={() => setEdit(c)}>{t('common.edit')}</button>
                    {user.role === 'admin' && <ConfirmButton label={t('common.delete')} confirm={t('cat.confirmDelete')} onConfirm={async () => { await del(`/catalogue/${c.id}`); toast(t('common.deleted')); cat.reload(); }} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && <CatalogueForm item={edit} onClose={() => setEdit(null)} onSaved={cat.reload} />}
      {importing && <ImportModal title={t('csv.importCatalogue')} endpoint="/catalogue/import" onClose={() => setImporting(false)} onDone={cat.reload}
        describe={(r) => `${r.nameEn} / ${r.nameNl}: ${num(r.kcal, 0)} kcal`} />}
    </>
  );
}

function CatalogueForm({ item, onClose, onSaved }: { item: Partial<CatalogueItem>; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const fe = useFormErrors();
  const editing = item.id !== undefined;
  const [f, setF] = useState({
    nameNl: s(item.nameNl), nameEn: s(item.nameEn), category: item.category ?? 'other', foodGroup: item.foodGroup ?? 'other', basis: item.basis ?? 'g',
    kcal: s(item.kcal), carbs: s(item.carbs), protein: s(item.protein), fat: s(item.fat), density: s(item.density), servingG: s(item.servingG), servingDesc: s(item.servingDesc),
    weightBasis: item.weightBasis ?? 'net', preparation: item.preparation ?? 'ready', prepWater: s(item.prepWater), source: s(item.source), isEstimate: item.isEstimate ?? true, notes: s(item.notes),
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string; type?: string; checked?: boolean } }) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }) as typeof x);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); fe.clear();
    const body = { ...f, kcal: nz(f.kcal), carbs: nz(f.carbs), protein: nz(f.protein), fat: nz(f.fat), density: nz(f.density), servingG: nz(f.servingG), prepWater: nz(f.prepWater) };
    try {
      if (editing) await put(`/catalogue/${item.id}`, body); else await post('/catalogue', body);
      toast(t('product.saved')); onSaved(); onClose();
    } catch (x) { fe.fail(x); }
  }
  const E = (k: string) => fe.fieldErrors[k] ?? null;
  return (
    <Modal title={editing ? t('cat.edit') : t('cat.add')} onClose={onClose} wide>
      <form onSubmit={submit} noValidate>
        <ErrorBox message={fe.formError} />
        <div className="grid-2">
          <Field label={t('cat.nameNl')} error={E('nameNl')}>{(p) => <input {...p} lang="nl" value={f.nameNl} onChange={set('nameNl')} autoFocus />}</Field>
          <Field label={t('cat.nameEn')} error={E('nameEn')}>{(p) => <input {...p} lang="en" value={f.nameEn} onChange={set('nameEn')} />}</Field>
          <Field label={t('f.category')}>{(p) => <select {...p} value={f.category} onChange={set('category')}>{CATEGORIES.map((c) => <option key={c} value={c}>{t(`cat.${c}` as MsgKey)}</option>)}</select>}</Field>
          <Field label={t('f.foodGroup')} hint={t('product.foodGroupHint')}>{(p) => <select {...p} value={f.foodGroup} onChange={set('foodGroup')}>{FOOD_GROUPS.map((c) => <option key={c} value={c}>{t(`group.${c}` as MsgKey)}</option>)}</select>}</Field>
        </div>
        <fieldset><legend>{t('cat.nutrition')}</legend>
          <div className="grid-2">
            <Field label={t('f.basis')}>{(p) => <select {...p} value={f.basis} onChange={set('basis')}><option value="g">{t('product.per100g')}</option><option value="ml">{t('product.per100ml')}</option></select>}</Field>
            <Field label={t('f.weightBasis')} hint={t('product.weightBasisHint')}>{(p) => <select {...p} value={f.weightBasis} onChange={set('weightBasis')}><option value="net">{t('weight.net')}</option><option value="drained">{t('weight.drained')}</option></select>}</Field>
          </div>
          <div className="grid-4">
            <Field label={t('f.kcal')} error={E('kcal')}>{(p) => <input {...p} inputMode="decimal" value={f.kcal} onChange={set('kcal')} />}</Field>
            <Field label={t('f.carbs')} error={E('carbs')}>{(p) => <input {...p} inputMode="decimal" value={f.carbs} onChange={set('carbs')} />}</Field>
            <Field label={t('f.protein')} error={E('protein')}>{(p) => <input {...p} inputMode="decimal" value={f.protein} onChange={set('protein')} />}</Field>
            <Field label={t('f.fat')} error={E('fat')}>{(p) => <input {...p} inputMode="decimal" value={f.fat} onChange={set('fat')} />}</Field>
          </div>
          <div className="grid-3">
            <Field label={t('f.density')} error={E('density')} hint={t('product.densityHint')}>{(p) => <input {...p} inputMode="decimal" value={f.density} onChange={set('density')} />}</Field>
            <Field label={t('cat.serving')} error={E('servingG')}>{(p) => <input {...p} inputMode="decimal" value={f.servingG} onChange={set('servingG')} />}</Field>
            <Field label={t('cat.servingDesc')}>{(p) => <input {...p} value={f.servingDesc} onChange={set('servingDesc')} />}</Field>
          </div>
        </fieldset>
        <div className="grid-2">
          <Field label={t('f.preparation')}>{(p) => <select {...p} value={f.preparation} onChange={set('preparation')}>{['ready', 'hot_water', 'cooking'].map((x) => <option key={x} value={x}>{t(`prep.${x}` as MsgKey)}</option>)}</select>}</Field>
          <Field label={t('f.prepWater')} error={E('prepWater')} hint={t('product.prepWaterHint')}>{(p) => <input {...p} inputMode="decimal" value={f.prepWater} onChange={set('prepWater')} />}</Field>
          <Field label={t('cat.source')} hint={t('cat.sourceHint')}>{(p) => <input {...p} value={f.source} onChange={set('source')} />}</Field>
          <div className="field check-field"><label><input type="checkbox" checked={f.isEstimate} onChange={set('isEstimate')} /> {t('cat.isEstimate')}</label><div className="hint">{t('cat.estimateHint')}</div></div>
        </div>
        <Field label={t('f.notes')}>{(p) => <input {...p} value={f.notes} onChange={set('notes')} />}</Field>
        <div className="actions"><button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn btn-primary">{t('common.save')}</button></div>
      </form>
    </Modal>
  );
}
