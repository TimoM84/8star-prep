import { useState } from 'react';
import { ApiErr, post } from '../api';
import { useI18n, type MsgKey } from '../i18n';
import { Badge, ErrorBox, Modal, toast } from '../ui';

interface PreviewRow { line: number; ok: boolean; action?: string; errors: { field?: string; code: string; params?: any }[]; data?: any }

export function ImportModal({ title, endpoint, templateHref, describe, onClose, onDone }: {
  title: string; endpoint: string; templateHref?: string; describe: (row: any) => string; onClose: () => void; onDone: () => void;
}) {
  const { t, err } = useI18n();
  const [csv, setCsv] = useState('');
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function readFile(f: File | undefined) {
    if (!f) return;
    setCsv(await f.text());
    setRows(null);
  }
  async function run(commit: boolean) {
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ rows: PreviewRow[]; committed: boolean; created?: number; updated?: number; products?: number; batches?: number }>(endpoint, { csv, commit, skipInvalid: commit });
      setRows(r.rows);
      if (r.committed) {
        toast(t('csv.imported', { n: r.rows.filter((x) => x.ok).length }));
        onDone();
        onClose();
      }
    } catch (e) {
      if (e instanceof ApiErr) { setError(err(e.code, { ...e.params })); if (e.body?.rows) setRows(e.body.rows); }
      else setError(t('err.server_error'));
    } finally { setBusy(false); }
  }
  const valid = rows?.filter((r) => r.ok).length ?? 0;
  const invalid = (rows?.length ?? 0) - valid;
  return (
    <Modal title={title} onClose={onClose} wide>
      <p>{t('csv.intro')} {templateHref && <a href={templateHref} download>{t('csv.template')}</a>}</p>
      <label className="btn" htmlFor="csvfile">{t('csv.chooseFile')}</label>
      <input id="csvfile" type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={(e) => readFile(e.target.files?.[0])} />
      <div className="field">
        <label htmlFor="csvtext">{t('csv.orPaste')}</label>
        <textarea id="csvtext" rows={6} value={csv} onChange={(e) => { setCsv(e.target.value); setRows(null); }} spellCheck={false} />
      </div>
      <ErrorBox message={error} />
      {rows && (
        <>
          <p role="status"><Badge tone="ok">{t('csv.valid', { n: valid })}</Badge> {invalid > 0 && <Badge tone="bad">{t('csv.invalid', { n: invalid })}</Badge>}</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">{t('csv.line')}</th><th scope="col">{t('csv.status')}</th><th scope="col">{t('csv.detail')}</th></tr></thead>
              <tbody>
                {rows.slice(0, 200).map((r) => (
                  <tr key={r.line}>
                    <td>{r.line}</td>
                    <td>{r.ok ? <Badge tone="ok">{r.action ? t(`csv.${r.action}` as MsgKey) : t('csv.ok')}</Badge> : <Badge tone="bad">{t('csv.error')}</Badge>}</td>
                    <td>{r.ok ? describe(r.data) : r.errors.map((e, i) => <div key={i}>{e.field ? `${t(`f.${e.field}` as MsgKey)}: ` : ''}{err(e.code, e.params)}</div>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 200 && <p className="hint">{t('csv.truncated')}</p>}
        </>
      )}
      <div className="actions">
        <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn" onClick={() => run(false)} disabled={busy || !csv.trim()}>{t('csv.preview')}</button>
        <button className="btn btn-primary" onClick={() => run(true)} disabled={busy || !rows || valid === 0}>{invalid > 0 ? t('csv.importValid', { n: valid }) : t('csv.import')}</button>
      </div>
    </Modal>
  );
}
