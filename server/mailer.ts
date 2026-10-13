import nodemailer from 'nodemailer';
import type { Config } from './config.js';
import { decryptSecret, encryptSecret } from './crypto.js';
import { getSetting, setSetting, type DB } from './db.js';

export interface SmtpSettings {
  host: string;
  port: number;
  security: 'tls' | 'starttls' | 'none';
  username: string;
  password: string;
  from: string;
}

export interface SmtpPublic extends Omit<SmtpSettings, 'password'> {
  passwordSet: boolean;
  enabled: boolean;
  sendHour: number;
}

export type SendFn = (smtp: SmtpSettings, msg: { to: string; subject: string; text: string; html: string }) => Promise<void>;

export const defaultSend: SendFn = async (smtp, msg) => {
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.security === 'tls',
    requireTLS: smtp.security === 'starttls',
    ignoreTLS: smtp.security === 'none',
    auth: smtp.username ? { user: smtp.username, pass: smtp.password } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  try {
    await transport.sendMail({ from: smtp.from, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html });
  } finally {
    transport.close();
  }
};

export function readSmtpPublic(db: DB): SmtpPublic {
  const sec = getSetting(db, 'smtp_security');
  return {
    host: getSetting(db, 'smtp_host') ?? '',
    port: Number(getSetting(db, 'smtp_port') ?? 587),
    security: sec === 'tls' || sec === 'none' ? sec : 'starttls',
    username: getSetting(db, 'smtp_user') ?? '',
    from: getSetting(db, 'smtp_from') ?? '',
    passwordSet: !!getSetting(db, 'smtp_pass_enc'),
    enabled: getSetting(db, 'mail_enabled') === '1',
    sendHour: Number(getSetting(db, 'mail_hour') ?? 8),
  };
}

export function readSmtp(db: DB, cfg: Config): SmtpSettings | null {
  const pub = readSmtpPublic(db);
  if (!pub.host || !pub.from) return null;
  const enc = getSetting(db, 'smtp_pass_enc');
  let password = '';
  if (enc) {
    try {
      password = decryptSecret(enc, cfg.encryptionKey);
    } catch {
      throw new Error('smtp_secret_unreadable');
    }
  }
  return { host: pub.host, port: pub.port, security: pub.security, username: pub.username, password, from: pub.from };
}

export function writeSmtp(db: DB, cfg: Config, s: Omit<SmtpSettings, 'password'> & { password?: string | null; enabled: boolean; sendHour: number }): void {
  setSetting(db, 'smtp_host', s.host);
  setSetting(db, 'smtp_port', String(s.port));
  setSetting(db, 'smtp_security', s.security);
  setSetting(db, 'smtp_user', s.username);
  setSetting(db, 'smtp_from', s.from);
  setSetting(db, 'mail_enabled', s.enabled ? '1' : '0');
  setSetting(db, 'mail_hour', String(s.sendHour));
  // undefined/null = keep the stored password; '' = clear it.
  if (s.password === '') setSetting(db, 'smtp_pass_enc', null);
  else if (typeof s.password === 'string') setSetting(db, 'smtp_pass_enc', encryptSecret(s.password, cfg.encryptionKey));
}

/** Error text that is safe to store and show: never includes credentials. */
export function safeError(err: unknown, smtp?: SmtpSettings | null): string {
  let m = err instanceof Error ? err.message : 'Unknown error';
  if (smtp?.password) m = m.split(smtp.password).join('***');
  return m.replace(/\s+/g, ' ').slice(0, 300);
}
