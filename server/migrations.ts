/** Ordered, append-only migrations. Never edit a released migration; add a new one. */
export const MIGRATIONS: { id: number; name: string; sql: string }[] = [
  {
    id: 1,
    name: 'initial',
    sql: `
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','member')),
  language TEXT NOT NULL DEFAULT 'nl' CHECK (language IN ('nl','en')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE members (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('adult','child')),
  age_years REAL,
  kcal REAL NOT NULL CHECK (kcal > 0),
  kcal_is_estimate INTEGER NOT NULL DEFAULT 1,
  water_l REAL NOT NULL CHECK (water_l >= 0),
  carbs_g REAL, protein_g REAL, fat_g REAL,
  sort INTEGER NOT NULL DEFAULT 0,
  is_demo INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE catalogue (
  id INTEGER PRIMARY KEY,
  name_nl TEXT NOT NULL,
  name_en TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  food_group TEXT NOT NULL DEFAULT 'other',
  basis TEXT NOT NULL DEFAULT 'g' CHECK (basis IN ('g','ml')),
  kcal REAL NOT NULL CHECK (kcal >= 0),
  carbs REAL, protein REAL, fat REAL,
  density_g_per_ml REAL,
  serving_g REAL,
  serving_desc TEXT,
  weight_basis TEXT NOT NULL DEFAULT 'net' CHECK (weight_basis IN ('net','drained')),
  preparation TEXT NOT NULL DEFAULT 'ready' CHECK (preparation IN ('ready','hot_water','cooking')),
  prep_water_ml_per100 REAL,
  source TEXT,
  is_estimate INTEGER NOT NULL DEFAULT 1,
  is_bundled INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  UNIQUE (source)
);

CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT,
  barcode TEXT,
  category TEXT NOT NULL DEFAULT 'other',
  location TEXT,
  catalogue_id INTEGER REFERENCES catalogue(id) ON DELETE SET NULL,
  is_water INTEGER NOT NULL DEFAULT 0,
  -- Label values (override the catalogue). Stated per 100 g or per 100 ml of n_weight_basis.
  n_kcal REAL, n_carbs REAL, n_protein REAL, n_fat REAL,
  n_basis TEXT NOT NULL DEFAULT 'g' CHECK (n_basis IN ('g','ml')),
  n_weight_basis TEXT NOT NULL DEFAULT 'net' CHECK (n_weight_basis IN ('net','drained')),
  -- Optional nutrition per piece (for products counted in pieces).
  pc_kcal REAL, pc_carbs REAL, pc_protein REAL, pc_fat REAL,
  drained_ratio REAL CHECK (drained_ratio IS NULL OR (drained_ratio > 0 AND drained_ratio <= 1)),
  density_g_per_ml REAL,
  amount_per_piece REAL,
  preparation TEXT CHECK (preparation IS NULL OR preparation IN ('ready','hot_water','cooking')),
  prep_water_ml_per100 REAL,
  food_group TEXT,
  notes TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_products_catalogue ON products(catalogue_id);

CREATE TABLE batches (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  packages REAL NOT NULL CHECK (packages >= 0),
  package_size REAL NOT NULL CHECK (package_size > 0),
  unit TEXT NOT NULL CHECK (unit IN ('g','kg','ml','l','piece')),
  remaining_base REAL NOT NULL CHECK (remaining_base >= 0),
  expiry_date TEXT,
  expiry_kind TEXT NOT NULL DEFAULT 'unknown' CHECK (expiry_kind IN ('tht','tgt','unknown')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_demo INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_batches_product ON batches(product_id);
CREATE INDEX idx_batches_expiry ON batches(expiry_date);

CREATE TABLE movements (
  id INTEGER PRIMARY KEY,
  batch_id INTEGER,
  product_name TEXT NOT NULL,
  delta_base REAL NOT NULL,
  kind TEXT NOT NULL,
  note TEXT,
  user_id INTEGER,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE meal_templates (
  id INTEGER PRIMARY KEY,
  name_nl TEXT NOT NULL,
  name_en TEXT NOT NULL,
  slots TEXT NOT NULL,
  components TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE plan (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  start_date TEXT NOT NULL,
  days INTEGER NOT NULL,
  facilities TEXT NOT NULL,
  ready_only INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE plan_meals (
  id INTEGER PRIMARY KEY,
  day_index INTEGER NOT NULL,
  slot TEXT NOT NULL,
  template_id INTEGER,
  items TEXT NOT NULL,
  locked INTEGER NOT NULL DEFAULT 0,
  consumed_at TEXT,
  UNIQUE (day_index, slot)
);

CREATE TABLE recipients (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  language TEXT NOT NULL DEFAULT 'nl' CHECK (language IN ('nl','en')),
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE notification_log (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('expiry','test')),
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent','failed')),
  error TEXT,
  item_count INTEGER NOT NULL DEFAULT 0,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per (batch, expiry date, stage, recipient) once a digest containing it was delivered.
CREATE TABLE notified (
  batch_id INTEGER NOT NULL,
  expiry_date TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('due','expired')),
  recipient_id INTEGER NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
  log_id INTEGER,
  PRIMARY KEY (batch_id, expiry_date, stage, recipient_id)
);
`,
  },
];
