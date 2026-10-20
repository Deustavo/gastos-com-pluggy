-- Schema idempotente: aplicado a cada abertura do banco.
-- Valores em centavos (INTEGER). Datas em ISO UTC (TEXT);
-- local_date é YYYY-MM-DD em America/Sao_Paulo.

CREATE TABLE IF NOT EXISTS connections (
  id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  nickname TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (provider, external_id)
);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY,
  connection_id INTEGER NOT NULL REFERENCES connections (id),
  external_id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  subtype TEXT,
  name TEXT,
  number_last4 TEXT,
  currency TEXT,
  balance_cents INTEGER,
  updated_at TEXT
);

-- fingerprint NÃO é UNIQUE: o sync faz delete+insert e uma colisão não pode derrubá-lo.
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts (id),
  provider_tx_id TEXT,
  fingerprint TEXT NOT NULL,
  date TEXT NOT NULL,
  local_date TEXT NOT NULL,
  description TEXT,
  description_raw TEXT,
  amount_cents_raw INTEGER NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('IN', 'OUT')),
  amount_cents_abs INTEGER NOT NULL,
  status TEXT NOT NULL,
  category TEXT,
  operation_type TEXT,
  bill_id TEXT,
  bill_forecast TEXT,
  installment_number INTEGER,
  total_installments INTEGER,
  kind TEXT,
  synced_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transactions_account_date ON transactions (account_id, date);
CREATE INDEX IF NOT EXISTS idx_transactions_fingerprint ON transactions (fingerprint);
CREATE INDEX IF NOT EXISTS idx_transactions_local_date ON transactions (local_date);
CREATE INDEX IF NOT EXISTS idx_transactions_bill_id ON transactions (bill_id);

CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts (id),
  external_id TEXT NOT NULL UNIQUE,
  due_date TEXT NOT NULL,
  closing_date TEXT,
  total_cents INTEGER NOT NULL,
  minimum_cents INTEGER
);

-- Edições manuais; sobrevivem aos re-syncs por serem ligadas ao fingerprint.
CREATE TABLE IF NOT EXISTS overrides (
  fingerprint TEXT PRIMARY KEY,
  category TEXT,
  ignored INTEGER NOT NULL DEFAULT 0,
  note TEXT
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id INTEGER PRIMARY KEY,
  connection_id INTEGER NOT NULL REFERENCES connections (id),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  error TEXT,
  tx_count INTEGER
);

-- Última resposta do fornecedor sobre a conexão (gravada a cada sync, mesmo com erro).
CREATE TABLE IF NOT EXISTS connection_status (
  connection_id INTEGER PRIMARY KEY REFERENCES connections (id),
  provider_status TEXT,
  last_updated_at TEXT,
  consent_expires_at TEXT,
  checked_at TEXT NOT NULL
);

-- Leitura da Fase 2: transações com os overrides aplicados.
-- Recriada a cada abertura para acompanhar mudanças de colunas (t.* é fixado na criação).
DROP VIEW IF EXISTS v_transactions;
CREATE VIEW v_transactions AS
SELECT
  t.*,
  COALESCE(o.category, t.category) AS effective_category,
  COALESCE(o.ignored, 0) AS ignored,
  o.category AS override_category,
  o.note AS override_note
FROM transactions t
LEFT JOIN overrides o ON o.fingerprint = t.fingerprint;
