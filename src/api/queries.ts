// Consultas da API: funções puras sobre o Db que montam as respostas do contrato.
// Leem de v_transactions (overrides já aplicados).

import type { Db } from "../db/index.ts";
import type { Kind } from "../sync/classify.ts";
import type {
  CategoriesResponse,
  ConnectionHealth,
  ConnectionsResponse,
  OverrideResponse,
  SummaryResponse,
  TransactionRow,
  TransactionsResponse,
} from "./contract.ts";

const DAY_MS = 86_400_000;
export const NO_CATEGORY = "Sem categoria";

// Categoria efetiva com o vazio normalizado (mesma expressão no SELECT e nos filtros)
const CATEGORY_SQL = `COALESCE(NULLIF(TRIM(effective_category), ''), '${NO_CATEGORY}')`;
// Contribuição da linha para o gasto: expense soma, refund abate, o resto é 0
const EXPENSE_SQL = "CASE kind WHEN 'expense' THEN amount_cents_abs WHEN 'refund' THEN -amount_cents_abs ELSE 0 END";
const INCOME_SQL = "CASE kind WHEN 'income' THEN amount_cents_abs ELSE 0 END";

// "YYYY-MM" deslocado em n meses
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export function getSummary(db: Db, month: string): SummaryResponse {
  const totals = db
    .prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN status != 'PENDING' THEN ${EXPENSE_SQL} END), 0) AS expense,
        COALESCE(SUM(CASE WHEN status != 'PENDING' THEN ${INCOME_SQL} END), 0) AS income,
        COALESCE(SUM(CASE WHEN status = 'PENDING' THEN ${EXPENSE_SQL} END), 0) AS pending,
        COALESCE(SUM(status = 'PENDING' AND kind IN ('expense', 'refund')), 0) AS pendingCount
      FROM v_transactions
      WHERE substr(local_date, 1, 7) = ? AND ignored = 0`)
    .get(month) as { expense: number; income: number; pending: number; pendingCount: number };

  const byCategory = db
    .prepare(`
      SELECT ${CATEGORY_SQL} AS category, SUM(${EXPENSE_SQL}) AS expenseCents
      FROM v_transactions
      WHERE substr(local_date, 1, 7) = ? AND ignored = 0 AND status != 'PENDING' AND kind IN ('expense', 'refund')
      GROUP BY 1 HAVING expenseCents != 0
      ORDER BY expenseCents DESC, category`)
    .all(month) as SummaryResponse["byCategory"];

  const first = addMonths(month, -11);
  const rows = db
    .prepare(`
      SELECT substr(local_date, 1, 7) AS month, SUM(${EXPENSE_SQL}) AS expenseCents, SUM(${INCOME_SQL}) AS incomeCents
      FROM v_transactions
      WHERE local_date >= ? AND local_date < ? AND ignored = 0 AND status != 'PENDING'
      GROUP BY 1`)
    .all(`${first}-01`, `${addMonths(month, 1)}-01`) as SummaryResponse["monthly"];
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  const monthly = Array.from({ length: 12 }, (_, i) => {
    const m = addMonths(first, i);
    const r = byMonth.get(m);
    return { month: m, expenseCents: r?.expenseCents ?? 0, incomeCents: r?.incomeCents ?? 0 };
  });

  return {
    month,
    expenseCents: totals.expense,
    incomeCents: totals.income,
    pendingExpenseCents: totals.pending,
    pendingCount: totals.pendingCount,
    byCategory,
    monthly,
  };
}

export interface TransactionFilters {
  month: string;
  category?: string;
  account?: number;
  status?: "POSTED" | "PENDING";
  kind?: Kind;
}

interface TxRow {
  id: number;
  fingerprint: string;
  account_id: number;
  account_type: "BANK" | "CREDIT";
  number_last4: string | null;
  account_name: string | null;
  local_date: string;
  description: string | null;
  direction: "IN" | "OUT";
  amount_cents_abs: number;
  kind: Kind;
  status: "POSTED" | "PENDING";
  category: string;
  provider_category: string | null;
  override_category: string | null;
  ignored: number;
  override_note: string | null;
  installment_number: number | null;
  total_installments: number | null;
}

export function accountLabel(type: "BANK" | "CREDIT", last4: string | null, name: string | null, id: number): string {
  if (last4) return `${type === "CREDIT" ? "Cartão" : "Conta"} ••••${last4}`;
  return name || `Conta ${id}`;
}

export function listTransactions(db: Db, f: TransactionFilters): TransactionsResponse {
  const where: string[] = [];
  const params: (string | number)[] = [];
  const add = (sql: string, value: string | number | undefined) => {
    if (value === undefined) return;
    where.push(sql);
    params.push(value);
  };
  add("substr(t.local_date, 1, 7) = ?", f.month);
  add(`${CATEGORY_SQL} = ?`, f.category);
  add("t.account_id = ?", f.account);
  add("t.status = ?", f.status);
  add("t.kind = ?", f.kind);

  const rows = db
    .prepare(`
      SELECT t.id, t.fingerprint, t.account_id, a.type AS account_type, a.number_last4, a.name AS account_name,
        t.local_date, t.description, t.direction, t.amount_cents_abs, t.kind, t.status,
        ${CATEGORY_SQL} AS category, t.category AS provider_category, t.override_category, t.ignored,
        t.override_note, t.installment_number, t.total_installments
      FROM v_transactions t JOIN accounts a ON a.id = t.account_id
      WHERE ${where.join(" AND ")}
      ORDER BY t.local_date DESC, t.date DESC, t.id DESC`)
    .all(...params) as TxRow[];

  const items = rows.map(
    (r): TransactionRow => ({
      id: r.id,
      fingerprint: r.fingerprint,
      accountId: r.account_id,
      accountLabel: accountLabel(r.account_type, r.number_last4, r.account_name, r.account_id),
      localDate: r.local_date,
      description: r.description ?? "",
      amountCents: r.direction === "OUT" ? -r.amount_cents_abs : r.amount_cents_abs,
      kind: r.kind,
      status: r.status,
      category: r.category,
      providerCategory: r.provider_category,
      overridden: r.override_category !== null,
      ignored: r.ignored === 1,
      note: r.override_note,
      installment:
        r.installment_number !== null && r.total_installments !== null
          ? { number: r.installment_number, total: r.total_installments }
          : null,
    }),
  );
  return { items };
}

export function listCategories(db: Db): CategoriesResponse {
  const rows = db.prepare(`SELECT DISTINCT ${CATEGORY_SQL} AS c FROM v_transactions`).all() as { c: string }[];
  return { categories: rows.map((r) => r.c).sort((a, b) => a.localeCompare(b, "pt-BR")) };
}

export function listConnections(db: Db, now: Date): ConnectionsResponse {
  const conns = db
    .prepare(`
      SELECT c.id, c.provider, c.nickname, s.provider_status, s.last_updated_at, s.consent_expires_at
      FROM connections c LEFT JOIN connection_status s ON s.connection_id = c.id
      ORDER BY c.id`)
    .all() as {
    id: number;
    provider: string;
    nickname: string | null;
    provider_status: string | null;
    last_updated_at: string | null;
    consent_expires_at: string | null;
  }[];
  const lastRun = db.prepare(
    "SELECT status, started_at, finished_at, error FROM sync_runs WHERE connection_id = ? ORDER BY id DESC LIMIT 1",
  );
  const accounts = db.prepare(`
    SELECT id, type, subtype, name, number_last4 AS numberLast4, balance_cents AS balanceCents
    FROM accounts WHERE connection_id = ? ORDER BY id`);

  const connections = conns.map((c): ConnectionHealth => {
    const run = lastRun.get(c.id) as
      | { status: string; started_at: string; finished_at: string | null; error: string | null }
      | undefined;
    const expires = c.consent_expires_at ? Date.parse(c.consent_expires_at) : NaN;
    return {
      id: c.id,
      provider: c.provider,
      nickname: c.nickname,
      providerStatus: c.provider_status,
      lastUpdatedAt: c.last_updated_at,
      consentExpiresAt: c.consent_expires_at,
      daysToConsentExpiry: Number.isNaN(expires) ? null : Math.floor((expires - now.getTime()) / DAY_MS),
      lastRun: run ? { status: run.status, startedAt: run.started_at, finishedAt: run.finished_at, error: run.error } : null,
      accounts: accounts.all(c.id) as ConnectionHealth["accounts"],
    };
  });
  return { connections };
}

export function fingerprintExists(db: Db, fingerprint: string): boolean {
  return db.prepare("SELECT 1 FROM transactions WHERE fingerprint = ? LIMIT 1").get(fingerprint) !== undefined;
}

export function getOverride(db: Db, fingerprint: string): OverrideResponse {
  const r = db.prepare("SELECT category, ignored, note FROM overrides WHERE fingerprint = ?").get(fingerprint) as
    | { category: string | null; ignored: number; note: string | null }
    | undefined;
  return { fingerprint, category: r?.category ?? null, ignored: r?.ignored === 1, note: r?.note ?? null };
}

// Grava o estado final; a linha some quando volta a ser equivalente ao padrão.
export function saveOverride(db: Db, o: OverrideResponse): void {
  if (o.category === null && !o.ignored && o.note === null) {
    db.prepare("DELETE FROM overrides WHERE fingerprint = ?").run(o.fingerprint);
    return;
  }
  db.prepare(`
    INSERT INTO overrides (fingerprint, category, ignored, note) VALUES (?, ?, ?, ?)
    ON CONFLICT (fingerprint) DO UPDATE SET category = excluded.category, ignored = excluded.ignored, note = excluded.note`).run(
    o.fingerprint, o.category, o.ignored ? 1 : 0, o.note,
  );
}
