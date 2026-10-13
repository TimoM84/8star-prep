/**
 * Online backup of the SQLite database (safe while the app is running).
 * Usage (inside the container): node dist/server/backup.js [target-file]
 * Default target: /data/backups/backup-<timestamp>.sqlite
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const dataDir = path.resolve(process.env.DATA_DIR || '/data');
const source = path.join(dataDir, 'app.sqlite');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = path.resolve(process.argv[2] || path.join(dataDir, 'backups', `backup-${stamp}.sqlite`));

if (!fs.existsSync(source)) {
  console.error(`No database found at ${source}`);
  process.exit(1);
}
fs.mkdirSync(path.dirname(target), { recursive: true });
const db = new Database(source, { readonly: true, fileMustExist: true });
db.backup(target)
  .then(() => { console.log(`Backup written to ${target}`); db.close(); })
  .catch((e: unknown) => { console.error('Backup failed:', e instanceof Error ? e.message : e); process.exit(1); });
