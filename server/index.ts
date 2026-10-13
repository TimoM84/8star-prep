import fs from 'node:fs';
import { createApp } from './app.js';
import { ensureAdmin } from './auth.js';
import { seedBundledCatalogue } from './catalogue.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { startScheduler } from './notifications.js';

async function main() {
  const cfg = loadConfig();
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  const db = openDb(cfg.dbPath);
  const catalogueFile = new URL(fs.existsSync(new URL('../../data/catalogue.json', import.meta.url)) ? '../../data/catalogue.json' : '../data/catalogue.json', import.meta.url);
  seedBundledCatalogue(db, catalogueFile);
  await ensureAdmin(db, cfg);
  const app = createApp(db, cfg);
  const server = app.listen(cfg.port, () => console.log(`8star-prep listening on :${cfg.port} (data: ${cfg.dataDir})`));
  if (!cfg.disableScheduler) startScheduler({ db, cfg });
  const stop = () => { server.close(() => { db.close(); process.exit(0); }); setTimeout(() => process.exit(0), 5000).unref(); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((e) => { console.error('Startup failed:', e instanceof Error ? e.message : e); process.exit(1); });
