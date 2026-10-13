import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Error with a stable code. The UI translates `code`; `params` fill placeholders. */
export class ApiError extends Error {
  constructor(public status: number, public code: string, public params?: Record<string, unknown>, public field?: string) {
    super(code);
  }
}

export const bad = (code: string, field?: string, params?: Record<string, unknown>) => new ApiError(400, code, params, field);
export const notFound = (code = 'not_found') => new ApiError(404, code);
export const conflict = (code: string, params?: Record<string, unknown>) => new ApiError(409, code, params);

export const wrap = (fn: (req: Request, res: Response) => unknown | Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    Promise.resolve()
      .then(() => fn(req, res))
      .catch(next);
  };

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: err.code, field: err.field, params: err.params });
    return;
  }
  const e = err as { type?: string; status?: number };
  if (e?.type === 'entity.too.large') { res.status(413).json({ error: 'payload_too_large' }); return; }
  if (e?.type === 'entity.parse.failed') { res.status(400).json({ error: 'invalid_json' }); return; }
  console.error('Unhandled error:', err instanceof Error ? err.message : 'unknown');
  res.status(500).json({ error: 'server_error' });
}

// ---- field validators (return clean values or throw ApiError with field) ----

type Obj = Record<string, unknown>;
export const asObj = (v: unknown): Obj => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw bad('invalid_body');
  return v as Obj;
};

export function str(o: Obj, k: string, opts: { max?: number; required?: boolean } = {}): string | null {
  const v = o[k];
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
    if (opts.required) throw bad('required', k);
    return null;
  }
  if (typeof v !== 'string') throw bad('invalid_value', k);
  const t = v.trim();
  if (t.length > (opts.max ?? 200)) throw bad('too_long', k, { max: opts.max ?? 200 });
  return t;
}

export function reqStr(o: Obj, k: string, max = 200): string {
  return str(o, k, { required: true, max }) as string;
}

export function num(o: Obj, k: string, opts: { min?: number; max?: number; required?: boolean; gt?: number } = {}): number | null {
  const v = o[k];
  if (v === undefined || v === null || v === '') {
    if (opts.required) throw bad('required', k);
    return null;
  }
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^-?\d+([.,]\d+)?$/.test(v.trim()) ? Number(v.trim().replace(',', '.')) : NaN;
  if (!Number.isFinite(n)) throw bad('invalid_number', k);
  if (opts.gt !== undefined && !(n > opts.gt)) throw bad('must_be_positive', k);
  if (opts.min !== undefined && n < opts.min) throw bad('too_small', k, { min: opts.min });
  if (opts.max !== undefined && n > opts.max) throw bad('too_large', k, { max: opts.max });
  return n;
}

export function reqNum(o: Obj, k: string, opts: { min?: number; max?: number; gt?: number } = {}): number {
  return num(o, k, { ...opts, required: true }) as number;
}

export function oneOf<T extends string>(o: Obj, k: string, allowed: readonly T[], opts: { required?: boolean; fallback?: T } = {}): T {
  const v = o[k];
  if (v === undefined || v === null || v === '') {
    if (opts.fallback !== undefined) return opts.fallback;
    throw bad('required', k);
  }
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) throw bad('invalid_value', k);
  return v as T;
}

export function bool(o: Obj, k: string, fallback = false): boolean {
  const v = o[k];
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'boolean') throw bad('invalid_value', k);
  return v;
}

export const idParam = (req: Request, name = 'id'): number => {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n) || n <= 0) throw notFound();
  return n;
};
