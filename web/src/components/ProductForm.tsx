import { useMemo, useState } from 'react';
import { get, post, put } from '../api';
import { useI18n, type MsgKey } from '../i18n';
import { ErrorBox, Field, Modal, toast, useFormErrors, useLoad } from '../ui';

export const CATEGORIES = ['water', 'grains', 'bread', 'canned', 'meals', 'fruit', 'dairy', 'spreads', 'nuts', 'snacks', 'baking', 'oils', 'drinks', 'baby', 'other'];
export const FOOD_GROUPS = ['cereal', 'bread', 'grain', 'legume', 'protein', 'vegetable', 'fruit', 'dairy', 'nuts', 'spread', 'fat', 'sweet', 'meal', 'snack', 'other'];
export const UNITS = ['g', 'kg', 'ml', 'l', 'piece'];

export interface CatalogueItem {
  id: number; nameNl: string; nameEn: string; category: string; foodGroup: string; basis: 'g' | 'ml';
  kcal: number; carbs: number | null; protein: number | null; fat: number | null; density: number | null;
  servingG: number | null; servingDesc: string | null; weightBasis: 'net' | 'drained'; preparation: string; prepWater: number | null;
  source: string | null; isEstimate: boolean; isBundled: boolean; notes: string | null;
}

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const n = (v: string): number | null | undefined => (v.trim() === '' ? undefined : (Number(v.replace(',', '.')) as number));

export function useCatalogue() {
  const { lang } = useI18n();
  const { data, reload } = useLoad(() => get<{ items: CatalogueItem[] }>('/catalogue'));
  const items = data?.items ?? [];
  const name = (c: Pick<CatalogueItem, 'nameNl' | 'nameEn'>) => (lang === 'nl' ? c.nameNl : c.nameEn);
  return { items, name, reload, loaded: !!data };
}

export function ProductForm({ product, onClose, onSaved }: { product?: any; onClose: () => void; onSaved: () => void }) {
  const { t, num } = useI18n();
  const cat = useCatalogue();
  const { data: locs } = useLoad(() => get<{ locations: string[] }>('/locations'));
  const fe = useFormErrors();
  const editing = !!product;
  const [f, setF] = useState({
    name: s(product?.name), brand: s(product?.brand), barcode: s(product?.barcode), category: product?.category ?? 'other', location: s(product?.location),
    isWater: !!product?.isWater, catalogueId: s(product?.catalogueId),
    kcal: s(product?.kcal), carbs: s(product?.carbs), protein: s(product?.protein), fat: s(product?.fat),
    basis: product?.basis ?? 'g', weightBasis: product?.weightBasis ?? 'net', drainedRatio: s(product?.drainedRatio), density: s(product?.density),
    amountPerPiece: s(product?.amountPerPiece), pieceKcal: s(product?.pieceKcal), pieceCarbs: s(product?.pieceCarbs), pieceProtein: s(product?.pieceProtein), pieceFat: s(product?.pieceFat),
    preparation: s(product?.preparation), prepWater: s(product?.prepWater), foodGroup: s(product?.foodGroup), notes: s(product?.notes),
    packages: '1', packageSize: '', unit: 'g', remaining: '', expiryKind: 'tht', expiryDate: '',
  });
  const [filter, setFilter] = useState('');
  const [showLabel, setShowLabel] = useState(!!(product?.kcal !== null && product?.kcal !== undefined) || !!(product?.pieceKcal));
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string; type?: string; checked?: boolean } }) =>
    setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }) as typeof x);

  const selected = cat.items.find((c) => String(c.id) === f.catalogueId);
  const options = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return cat.items.filter((c) => !q || c.nameNl.toLowerCase().includes(q) || c.nameEn.toLowerCase().includes(q));
  }, [cat.items, filter]);
  const labelKcal = n(f.kcal);
  const macroSum = (n(f.carbs) ?? 0) * 4 + (n(f.protein) ?? 0) * 4 + (n(f.fat) ?? 0) * 9;
  const mismatch = labelKcal !== undefined && labelKcal !== null && macroSum > 0 && Math.abs(macroSum - labelKcal) > Math.max(40, labelKcal * 0.3);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    fe.clear();
    setBusy(true);
    const body: Record<string, unknown> = {
      name: f.name, brand: f.brand, barcode: f.barcode, category: f.isWater ? 'water' : f.category, location: f.location, isWater: f.isWater,
      catalogueId: f.catalogueId ? Number(f.catalogueId) : null,
      kcal: showLabel ? n(f.kcal) : null, carbs: showLabel ? n(f.carbs) : null, protein: showLabel ? n(f.protein) : null, fat: showLabel ? n(f.fat) : null,
      basis: f.basis, weightBasis: f.weightBasis, drainedRatio: n(f.drainedRatio), density: n(f.density), amountPerPiece: n(f.amountPerPiece),
      pieceKcal: n(f.pieceKcal), pieceCarbs: n(f.pieceCarbs), pieceProtein: n(f.pieceProtein), pieceFat: n(f.pieceFat),
      preparation: f.preparation || null, prepWater: n(f.prepWater), foodGroup: f.foodGroup || null, notes: f.notes,
    };
    try {
      if (editing) await put(`/products/${product.id}`, body);
      else {
        body.batch = { packages: n(f.packages), packageSize: n(f.packageSize), unit: f.unit, remaining: n(f.remaining), expiryDate: f.expiryDate || null, expiryKind: f.expiryDate ? f.expiryKind : 'unknown' };
        await post('/products', body);
      }
      toast(t('product.saved'));
      onSaved();
      onClose();
    } catch (err) { fe.fail(err); } finally { setBusy(false); }
  }

  const E = (k: string) => fe.fieldErrors[k] ?? null;
  const showDrained = f.weightBasis === 'drained' || selected?.weightBasis === 'drained';
  return (
    <Modal title={editing ? t('product.edit') : t('product.add')} onClose={onClose} wide>
      <form onSubmit={submit} noValidate>
        <ErrorBox message={fe.formError} />
        <div className="grid-2">
          <Field label={t('f.name')} error={E('name')}>{(p) => <input {...p} value={f.name} onChange={set('name')} required maxLength={120} />}</Field>
          <Field label={t('f.brand')}>{(p) => <input {...p} value={f.brand} onChange={set('brand')} maxLength={80} />}</Field>
          <Field label={t('f.category')} error={E('category')}>{(p) => (
            <select {...p} value={f.isWater ? 'water' : f.category} onChange={set('category')} disabled={f.isWater}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{t(`cat.${c}` as MsgKey)}</option>)}
            </select>)}</Field>
          <Field label={t('f.location')} hint={t('product.locationHint')}>{(p) => (
            <>
              <input {...p} list="locations" value={f.location} onChange={set('location')} maxLength={80} />
              <datalist id="locations">{(locs?.locations ?? []).map((l) => <option key={l} value={l} />)}</datalist>
            </>)}</Field>
          <Field label={t('f.barcode')}>{(p) => <input {...p} value={f.barcode} onChange={set('barcode')} inputMode="numeric" maxLength={40} />}</Field>
          <div className="field check-field">
            <label><input type="checkbox" checked={f.isWater} onChange={set('isWater')} /> {t('product.isWater')}</label>
            <div className="hint">{t('product.isWaterHint')}</div>
          </div>
        </div>

        {!f.isWater && (
          <fieldset>
            <legend>{t('product.nutritionTitle')}</legend>
            <p className="hint">{t('product.nutritionIntro')}</p>
            <Field label={t('product.catalogueRef')} error={E('catalogueId')} hint={t('product.catalogueRefHint')}>{(p) => (
              <>
                <input type="search" placeholder={t('common.search')} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={t('common.search')} />
                <select {...p} value={f.catalogueId} onChange={set('catalogueId')}>
                  <option value="">{t('product.noCatalogue')}</option>
                  {options.map((c) => <option key={c.id} value={c.id}>{cat.name(c)}</option>)}
                </select>
              </>)}</Field>
            {selected && (
              <div className="alert alert-info">
                <strong>{cat.name(selected)}</strong> – {t(selected.basis === 'g' ? 'product.per100g' : 'product.per100ml')}: {num(selected.kcal, 0)} kcal ·{' '}
                {t('f.carbs')} {num(selected.carbs)} g · {t('f.protein')} {num(selected.protein)} g · {t('f.fat')} {num(selected.fat)} g
                {selected.weightBasis === 'drained' && <> · <em>{t('product.drainedValues')}</em></>}
                <br /><span className="muted">{selected.isEstimate ? t('product.estimateNote') : t('product.catalogueNote')} {selected.source ?? ''}</span>
              </div>
            )}
            <label className="inline-check"><input type="checkbox" checked={showLabel} onChange={(e) => setShowLabel(e.target.checked)} /> {t('product.useLabel')}</label>
            {showLabel && (
              <div className="subpanel">
                <p className="hint">{t('product.labelHint')}</p>
                <div className="grid-4">
                  <Field label={t('f.kcal')} error={E('kcal')}>{(p) => <input {...p} inputMode="decimal" value={f.kcal} onChange={set('kcal')} />}</Field>
                  <Field label={t('f.carbs')} error={E('carbs')}>{(p) => <input {...p} inputMode="decimal" value={f.carbs} onChange={set('carbs')} />}</Field>
                  <Field label={t('f.protein')} error={E('protein')}>{(p) => <input {...p} inputMode="decimal" value={f.protein} onChange={set('protein')} />}</Field>
                  <Field label={t('f.fat')} error={E('fat')}>{(p) => <input {...p} inputMode="decimal" value={f.fat} onChange={set('fat')} />}</Field>
                </div>
                {mismatch && <div className="alert alert-warn" role="status">{t('product.macroMismatch', { calc: Math.round(macroSum) })}</div>}
                <div className="grid-2">
                  <Field label={t('f.basis')}>{(p) => (
                    <select {...p} value={f.basis} onChange={set('basis')}>
                      <option value="g">{t('product.per100g')}</option><option value="ml">{t('product.per100ml')}</option>
                    </select>)}</Field>
                  <Field label={t('f.weightBasis')} hint={t('product.weightBasisHint')}>{(p) => (
                    <select {...p} value={f.weightBasis} onChange={set('weightBasis')}>
                      <option value="net">{t('weight.net')}</option><option value="drained">{t('weight.drained')}</option>
                    </select>)}</Field>
                </div>
              </div>
            )}
            {showDrained && (
              <Field label={t('f.drainedRatio')} error={E('drainedRatio')} hint={t('product.drainedRatioHint')}>{(p) => <input {...p} inputMode="decimal" placeholder="0.65" value={f.drainedRatio} onChange={set('drainedRatio')} />}</Field>
            )}
            <details>
              <summary>{t('product.advanced')}</summary>
              <div className="grid-2">
                <Field label={t('f.density')} error={E('density')} hint={t('product.densityHint')}>{(p) => <input {...p} inputMode="decimal" value={f.density} onChange={set('density')} />}</Field>
                <Field label={t('f.amountPerPiece')} error={E('amountPerPiece')} hint={t('product.amountPerPieceHint')}>{(p) => <input {...p} inputMode="decimal" value={f.amountPerPiece} onChange={set('amountPerPiece')} />}</Field>
                <Field label={t('f.pieceKcal')} error={E('pieceKcal')} hint={t('product.pieceKcalHint')}>{(p) => <input {...p} inputMode="decimal" value={f.pieceKcal} onChange={set('pieceKcal')} />}</Field>
                <div className="grid-3">
                  <Field label={t('f.carbs')}>{(p) => <input {...p} inputMode="decimal" value={f.pieceCarbs} onChange={set('pieceCarbs')} />}</Field>
                  <Field label={t('f.protein')}>{(p) => <input {...p} inputMode="decimal" value={f.pieceProtein} onChange={set('pieceProtein')} />}</Field>
                  <Field label={t('f.fat')}>{(p) => <input {...p} inputMode="decimal" value={f.pieceFat} onChange={set('pieceFat')} />}</Field>
                </div>
                <Field label={t('f.preparation')} hint={t('product.preparationHint')}>{(p) => (
                  <select {...p} value={f.preparation} onChange={set('preparation')}>
                    <option value="">{t('product.fromCatalogue')}</option>
                    {['ready', 'hot_water', 'cooking'].map((x) => <option key={x} value={x}>{t(`prep.${x}` as MsgKey)}</option>)}
                  </select>)}</Field>
                <Field label={t('f.prepWater')} error={E('prepWater')} hint={t('product.prepWaterHint')}>{(p) => <input {...p} inputMode="decimal" value={f.prepWater} onChange={set('prepWater')} />}</Field>
                <Field label={t('f.foodGroup')} hint={t('product.foodGroupHint')}>{(p) => (
                  <select {...p} value={f.foodGroup} onChange={set('foodGroup')}>
                    <option value="">{t('product.fromCatalogue')}</option>
                    {FOOD_GROUPS.map((x) => <option key={x} value={x}>{t(`group.${x}` as MsgKey)}</option>)}
                  </select>)}</Field>
                <Field label={t('f.notes')}>{(p) => <input {...p} value={f.notes} onChange={set('notes')} maxLength={500} />}</Field>
              </div>
            </details>
          </fieldset>
        )}
        {f.isWater && (
          <details>
            <summary>{t('product.advanced')}</summary>
            <Field label={t('f.amountPerPiece')} error={E('amountPerPiece')} hint={t('product.waterPieceHint')}>{(p) => <input {...p} inputMode="decimal" value={f.amountPerPiece} onChange={set('amountPerPiece')} />}</Field>
          </details>
        )}

        {!editing && (
          <fieldset>
            <legend>{t('product.firstBatch')}</legend>
            <div className="grid-4">
              <Field label={t('f.packages')} error={E('packages')}>{(p) => <input {...p} inputMode="decimal" value={f.packages} onChange={set('packages')} />}</Field>
              <Field label={t('f.packageSize')} error={E('packageSize')} hint={t('product.packageSizeHint')}>{(p) => <input {...p} inputMode="decimal" value={f.packageSize} onChange={set('packageSize')} />}</Field>
              <Field label={t('f.unit')} error={E('unit')}>{(p) => (
                <select {...p} value={f.unit} onChange={set('unit')}>{UNITS.map((u) => <option key={u} value={u}>{t(`unit.${u}` as MsgKey)}</option>)}</select>)}</Field>
              <Field label={t('f.remaining')} error={E('remaining')} hint={t('product.remainingHint')}>{(p) => <input {...p} inputMode="decimal" value={f.remaining} onChange={set('remaining')} />}</Field>
            </div>
            <div className="grid-2">
              <Field label={t('f.expiryKind')}>{(p) => (
                <select {...p} value={f.expiryKind} onChange={set('expiryKind')}>
                  <option value="tht">{t('exp.tht')}</option><option value="tgt">{t('exp.tgt')}</option>
                </select>)}</Field>
              <Field label={t('f.expiryDate')} error={E('expiryDate')} hint={t('product.expiryHint')}>{(p) => <input {...p} type="date" value={f.expiryDate} onChange={set('expiryDate')} />}</Field>
            </div>
          </fieldset>
        )}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{t('common.save')}</button>
        </div>
      </form>
    </Modal>
  );
}
