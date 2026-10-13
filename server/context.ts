import type { LoginLimiter } from './auth.js';
import type { Config } from './config.js';
import type { DB } from './db.js';
import type { SendFn } from './mailer.js';

export interface Ctx {
  db: DB;
  cfg: Config;
  limiter: LoginLimiter;
  send?: SendFn;
  now?: () => Date;
}

export const nowOf = (ctx: Ctx): Date => (ctx.now ? ctx.now() : new Date());
