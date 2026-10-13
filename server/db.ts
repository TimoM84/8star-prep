import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { MIGRATIONS } from './migrations.js';
import { DEFAULT_TEMPLATES } from './defaults.js';

export type DB = Database.Database;

export function openDb(file: string, opts: { backupDir?: string } = {}): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db, file === ':memory:' ? undefined : opts.backupDir ?? path.join(path.dirname(file), 'backups'));
  return db;
}

/** Applies pending migrations in order, each in a transaction. Makes a backup first if the DB has data. */
export function migrate(db: DB, backupDir?: string): number[] {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime(\'now\')))');
  const done = new Set((db.prepare('SELECT id FROM schema_migrations').all() as { id: number }[]).map((r) => r.id));
  const pending = MIGRATIONS.filter((m) => !done.has(m.id)).sort((a, b) => a.id - b.id);
  if (pending.length === 0) return [];
  if (done.size > 0 && backupDir) {
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    // VACUUM INTO produces a consistent single-file copy even in WAL mode.
    db.exec(`VACUUM INTO '${path.join(backupDir, `pre-migration-${stamp}.sqlite`).replace(/'/g, "''")}'`);
  }
  for (const m of pending) {
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (id, name) VALUES (?, ?)').run(m.id, m.name);
    })();
  }
  if (!done.has(1)) seedTemplates(db);
  return pending.map((m) => m.id);
}

function seedTemplates(db: DB): void {
  const ins = db.prepare('INSERT INTO meal_templates (name_nl, name_en, slots, components, active) VALUES (?,?,?,?,1)');
  for (const t of DEFAULT_TEMPLATES) ins.run(t.nameNl, t.nameEn, JSON.stringify(t.slots), JSON.stringify(t.components));
}

export function getSetting(db: DB, key: string): string | null {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return r ? r.value : null;
}

export function setSetting(db: DB, key: string, value: string | null): void {
  if (value === null) db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  else db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
