import { Router } from 'express';
import { requireAdmin } from '../auth.js';
import type { Ctx } from '../context.js';
import { nowOf } from '../context.js';
import { asObj, bad, bool, conflict, idParam, notFound, num, oneOf, reqNum, reqStr, str, wrap } from '../http.js';
import { readSmtpPublic, writeSmtp } from '../mailer.js';
import { runExpiryCheck, sendTestEmail } from '../notifications.js';

const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;

export function mailRoutes(ctx: Ctx): Router {
  const { db, cfg } = ctx;
  const r = Router();
  r.use(requireAdmin);

  const recipients = () => (db.prepare('SELECT id, email, language, active FROM recipients ORDER BY id').all() as { id: number; email: string; language: string; active: number }[])
    .map((x) => ({ ...x, active: x.active === 1 }));
  const history = () => db.prepare('SELECT id, kind, recipient_email AS recipientEmail, subject, status, error, item_count AS itemCount, at FROM notification_log ORDER BY id DESC LIMIT 100').all();

  r.get('/mail', wrap((_req, res) => {
    res.json({ smtp: readSmtpPublic(db), recipients: recipients(), history: history() });
  }));

  r.put('/mail/smtp', wrap((req, res) => {
    const o = asObj(req.body);
    const host = str(o, 'host', { max: 255 }) ?? '';
    const from = str(o, 'from', { max: 255 }) ?? '';
    const enabled = bool(o, 'enabled');
    if (enabled && (!host || !from)) throw bad('smtp_incomplete', host ? 'from' : 'host');
    if (from && !/^[^\r\n<>]*<[^\s@<>]+@[^\s@<>]+>$|^[^\s@<>\r\n]+@[^\s@<>\r\n]+$/.test(from)) throw bad('invalid_email', 'from');
    const port = reqNum(o, 'port', { min: 1, max: 65535 });
    if (!Number.isInteger(port)) throw bad('must_be_integer', 'port');
    const sendHour = num(o, 'sendHour', { min: 0, max: 23 }) ?? 8;
    if (!Number.isInteger(sendHour)) throw bad('must_be_integer', 'sendHour');
    // Password: omitted/null keeps the stored one; '' clears; any other string replaces it.
    const pw = o.password === undefined || o.password === null ? null : typeof o.password === 'string' ? o.password : (() => { throw bad('invalid_value', 'password'); })();
    writeSmtp(db, cfg, { host, port, security: oneOf(o, 'security', ['tls', 'starttls', 'none'] as const), username: str(o, 'username', { max: 255 }) ?? '', from, password: pw, enabled, sendHour });
    res.json({ smtp: readSmtpPublic(db) });
  }));

  r.post('/mail/recipients', wrap((req, res) => {
    const o = asObj(req.body);
    const email = reqStr(o, 'email', 255);
    if (!EMAIL_RE.test(email)) throw bad('invalid_email', 'email');
    if (db.prepare('SELECT 1 FROM recipients WHERE email = ?').get(email)) throw conflict('recipient_exists');
    const id = db.prepare('INSERT INTO recipients (email, language, active) VALUES (?,?,1)').run(email, oneOf(o, 'language', ['nl', 'en'] as const, { fallback: 'nl' })).lastInsertRowid;
    res.status(201).json({ id: Number(id), recipients: recipients() });
  }));

  r.put('/mail/recipients/:id', wrap((req, res) => {
    const id = idParam(req);
    const o = asObj(req.body);
    const cur = db.prepare('SELECT email FROM recipients WHERE id = ?').get(id) as { email: string } | undefined;
    if (!cur) throw notFound();
    const email = o.email === undefined ? cur.email : reqStr(o, 'email', 255);
    if (!EMAIL_RE.test(email)) throw bad('invalid_email', 'email');
    db.prepare('UPDATE recipients SET email = ?, language = ?, active = ? WHERE id = ?')
      .run(email, oneOf(o, 'language', ['nl', 'en'] as const), bool(o, 'active', true) ? 1 : 0, id);
    res.json({ recipients: recipients() });
  }));

  r.delete('/mail/recipients/:id', wrap((req, res) => {
    if (db.prepare('DELETE FROM recipients WHERE id = ?').run(idParam(req)).changes === 0) throw notFound();
    res.json({ recipients: recipients() });
  }));

  r.post('/mail/test', wrap(async (req, res) => {
    const o = asObj(req.body);
    const to = reqStr(o, 'to', 255);
    if (!EMAIL_RE.test(to)) throw bad('invalid_email', 'to');
    const result = await sendTestEmail({ db, cfg, send: ctx.send }, to, oneOf(o, 'language', ['nl', 'en'] as const, { fallback: req.user!.language }));
    res.json({ ...result, history: history() });
  }));

  r.post('/mail/run', wrap(async (_req, res) => {
    const result = await runExpiryCheck({ db, cfg, send: ctx.send, now: nowOf(ctx) });
    res.json({ result, history: history() });
  }));

  return r;
}
