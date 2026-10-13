import { daysBetween, hourIn, todayIn } from '../shared/dates.js';
import { fromBase } from '../shared/units.js';
import type { Unit } from '../shared/types.js';
import type { Config } from './config.js';
import { getSetting, setSetting, type DB } from './db.js';
import { emailText, type Lang } from './emailText.js';
import { defaultSend, readSmtp, safeError, type SendFn, type SmtpSettings } from './mailer.js';
import { readHousehold } from './settings.js';

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Strips CR/LF so user text can never inject mail headers via the subject. */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ');

export interface DigestItem {
  batchId: number;
  name: string;
  expiryDate: string;
  kind: 'tht' | 'tgt';
  stage: 'due' | 'expired';
  days: number;
  amount: string;
}

export function formatAmount(remainingBase: number, unit: Unit, lang: Lang): string {
  const nf = new Intl.NumberFormat(lang === 'nl' ? 'nl-NL' : 'en-GB', { maximumFractionDigits: 2 });
  const disp = unit === 'kg' || unit === 'l' ? fromBase(remainingBase, unit) : remainingBase;
  return `${nf.format(disp)} ${unit === 'piece' ? (lang === 'nl' ? 'stuks' : 'pcs') : unit}`;
}

export function buildDigest(items: DigestItem[], lang: Lang, timeZone: string): { subject: string; text: string; html: string } {
  const t = emailText(lang);
  const locale = lang === 'nl' ? 'nl-NL' : 'en-GB';
  const fmtDate = (d: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
  const due = items.filter((i) => i.stage === 'due').sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  const expired = items.filter((i) => i.stage === 'expired').sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  const subject = oneLine(due.length && expired.length ? t.subjectBoth(items.length) : expired.length ? t.subjectExpired(items.length) : t.subjectDue(items.length));
  const when = (i: DigestItem) => (i.days >= 0 ? t.inDays(i.days) : t.agoDays(-i.days));
  const kindLabel = (k: 'tht' | 'tgt') => (k === 'tgt' ? t.tgt : t.tht);

  const textSection = (title: string, list: DigestItem[]) =>
    list.length === 0 ? '' : `${title}\n${list.map((i) => `- ${i.name} (${i.amount}) - ${fmtDate(i.expiryDate)}, ${when(i)}, ${kindLabel(i.kind)}`).join('\n')}\n\n`;
  const text = `${t.intro}\n\n${textSection(t.dueTitle, due)}${textSection(t.expiredTitle, expired)}${t.footer}\n`;

  const htmlSection = (title: string, list: DigestItem[]) =>
    list.length === 0 ? '' : `<h2 style="font-size:16px;margin:20px 0 8px">${escapeHtml(title)}</h2>
<table role="presentation" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:14px">
<tr style="text-align:left;border-bottom:1px solid #ccc"><th>${t.colProduct}</th><th>${t.colAmount}</th><th>${t.colDate}</th><th>${t.colWhen}</th><th>${t.colType}</th></tr>
${list.map((i) => `<tr style="border-bottom:1px solid #eee"><td>${escapeHtml(i.name)}</td><td>${escapeHtml(i.amount)}</td><td>${escapeHtml(fmtDate(i.expiryDate))}</td><td>${escapeHtml(when(i))}</td><td>${escapeHtml(kindLabel(i.kind))}</td></tr>`).join('\n')}
</table>`;
  const html = `<!doctype html><html lang="${lang}"><body style="font-family:system-ui,sans-serif;color:#222;max-width:640px;margin:auto;padding:16px">
<p>${escapeHtml(t.intro)}</p>${htmlSection(t.dueTitle, due)}${htmlSection(t.expiredTitle, expired)}
<p style="color:#555;font-size:13px;margin-top:24px">${escapeHtml(t.footer)}</p></body></html>`;
  void timeZone;
  return { subject, text, html };
}

export interface CheckDeps {
  db: DB;
  cfg: Config;
  send?: SendFn;
  now?: Date;
}

export interface CheckResult {
  status: 'not_configured' | 'no_recipients' | 'done';
  sent: number;
  failed: number;
  skipped: number;
}

interface Candidate {
  id: number; name: string; unit: Unit; remaining_base: number; expiry_date: string; expiry_kind: 'tht' | 'tgt';
}

/** Sends one digest per active recipient with batches not yet reported for their current stage. */
export async function runExpiryCheck(deps: CheckDeps): Promise<CheckResult> {
  const { db, cfg } = deps;
  const send = deps.send ?? defaultSend;
  const smtp = readSmtp(db, cfg);
  if (!smtp) return { status: 'not_configured', sent: 0, failed: 0, skipped: 0 };
  const house = readHousehold(db, cfg);
  const today = todayIn(house.timezone, deps.now);
  const recipients = db.prepare('SELECT id, email, language FROM recipients WHERE active = 1 ORDER BY id').all() as { id: number; email: string; language: Lang }[];
  if (recipients.length === 0) return { status: 'no_recipients', sent: 0, failed: 0, skipped: 0 };

  const candidates = db.prepare(`SELECT b.id, p.name, b.unit, b.remaining_base, b.expiry_date, b.expiry_kind
    FROM batches b JOIN products p ON p.id = b.product_id
    WHERE b.remaining_base > 0 AND b.expiry_date IS NOT NULL AND b.expiry_kind != 'unknown'`).all() as Candidate[];
  const isNotified = db.prepare('SELECT 1 FROM notified WHERE batch_id = ? AND expiry_date = ? AND stage = ? AND recipient_id = ?');
  const markNotified = db.prepare('INSERT OR IGNORE INTO notified (batch_id, expiry_date, stage, recipient_id, log_id) VALUES (?,?,?,?,?)');
  const logIns = db.prepare('INSERT INTO notification_log (kind, recipient_email, subject, status, error, item_count) VALUES (?,?,?,?,?,?)');

  const result: CheckResult = { status: 'done', sent: 0, failed: 0, skipped: 0 };
  for (const r of recipients) {
    const items: DigestItem[] = [];
    for (const c of candidates) {
      const days = daysBetween(today, c.expiry_date);
      const stage = days < 0 ? 'expired' : days <= house.reminderDays ? 'due' : null;
      if (!stage || isNotified.get(c.id, c.expiry_date, stage, r.id)) continue;
      items.push({ batchId: c.id, name: c.name, expiryDate: c.expiry_date, kind: c.expiry_kind, stage, days, amount: formatAmount(c.remaining_base, c.unit, r.language) });
    }
    if (items.length === 0) { result.skipped++; continue; }
    const digest = buildDigest(items, r.language, house.timezone);
    try {
      await send(smtp, { to: r.email, subject: digest.subject, text: digest.text, html: digest.html });
      db.transaction(() => {
        const log = logIns.run('expiry', r.email, digest.subject, 'sent', null, items.length);
        for (const i of items) markNotified.run(i.batchId, i.expiryDate, i.stage, r.id, Number(log.lastInsertRowid));
      })();
      result.sent++;
    } catch (err) {
      logIns.run('expiry', r.email, digest.subject, 'failed', safeError(err, smtp), items.length);
      result.failed++;
    }
  }
  return result;
}

export async function sendTestEmail(deps: CheckDeps, to: string, lang: Lang): Promise<{ ok: boolean; error?: string }> {
  const send = deps.send ?? defaultSend;
  let smtp: SmtpSettings | null = null;
  const t = emailText(lang);
  try {
    smtp = readSmtp(deps.db, deps.cfg);
    if (!smtp) return { ok: false, error: 'not_configured' };
    await send(smtp, { to, subject: t.testSubject, text: t.testBody, html: `<p>${escapeHtml(t.testBody)}</p>` });
    deps.db.prepare('INSERT INTO notification_log (kind, recipient_email, subject, status, error, item_count) VALUES (?,?,?,?,?,0)').run('test', to, t.testSubject, 'sent', null);
    return { ok: true };
  } catch (err) {
    const msg = safeError(err, smtp);
    deps.db.prepare('INSERT INTO notification_log (kind, recipient_email, subject, status, error, item_count) VALUES (?,?,?,?,?,0)').run('test', to, t.testSubject, 'failed', msg);
    return { ok: false, error: msg };
  }
}

let running = false;

/**
 * Called every few minutes. Runs the daily check once the configured hour has passed, unless it
 * already completed today. After failures it retries at most once per hour until it succeeds.
 */
export async function schedulerTick(deps: CheckDeps): Promise<CheckResult | null> {
  const { db, cfg } = deps;
  if (running || getSetting(db, 'mail_enabled') !== '1') return null;
  const now = deps.now ?? new Date();
  const house = readHousehold(db, cfg);
  const today = todayIn(house.timezone, now);
  if (getSetting(db, 'last_mail_run_date') === today) return null;
  if (hourIn(house.timezone, now) < Number(getSetting(db, 'mail_hour') ?? 8)) return null;
  const lastAttempt = Number(getSetting(db, 'last_mail_attempt_ms') ?? 0);
  if (now.getTime() - lastAttempt < 3_600_000) return null;
  running = true;
  try {
    setSetting(db, 'last_mail_attempt_ms', String(now.getTime()));
    const res = await runExpiryCheck({ ...deps, now });
    if (res.status === 'done' && res.failed === 0) setSetting(db, 'last_mail_run_date', today);
    return res;
  } finally {
    running = false;
  }
}

export function startScheduler(deps: CheckDeps): NodeJS.Timeout {
  const tick = () => { schedulerTick(deps).catch((e) => console.error('Scheduler error:', e instanceof Error ? e.message : 'unknown')); };
  setTimeout(tick, 10_000).unref();
  const t = setInterval(tick, 5 * 60_000);
  t.unref();
  return t;
}
