// Consultas da API: funções puras sobre o Db que montam as respostas do contrato.
// Leem de v_transactions (tradução, regras e overrides já aplicados).

import { EXTRA_CATEGORIES, NO_CATEGORY } from "../categorize/categories.ts";
import { median } from "../categorize/nature.ts";
import { byPriority, compileRule, compileRules, loadRules, matchRule, type CompiledRule } from "../categorize/rules.ts";
import type { Db } from "../db/index.ts";
import type { Kind } from "../sync/classify.ts";
import type {
  Bank,
  CategoriesResponse,
  CategoryRule,
  Nature,
  NatureEntry,
  NatureResponse,
  NaturesResponse,
  NatureSource,
  CategorySource,
  ConnectionHealth,
  ConnectionsResponse,
  OverrideResponse,
  RulePreviewResponse,
  RulesResponse,
  SummaryResponse,
  TransactionRow,
  TransactionsResponse,
} from "./contract.ts";

const DAY_MS = 86_400_000;

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
        COALESCE(SUM(CASE WHEN status != 'PENDING' AND nature = 'fixed' THEN ${EXPENSE_SQL} END), 0) AS fixed,
        COALESCE(SUM(CASE WHEN status != 'PENDING' THEN ${INCOME_SQL} END), 0) AS income,
        COALESCE(SUM(CASE WHEN status = 'PENDING' THEN ${EXPENSE_SQL} END), 0) AS pending,
        COALESCE(SUM(status = 'PENDING' AND kind IN ('expense', 'refund')), 0) AS pendingCount
      FROM v_transactions
      WHERE substr(local_date, 1, 7) = ? AND ignored = 0`)
    .get(month) as { expense: number; fixed: number; income: number; pending: number; pendingCount: number };

  const byCategory = db
    .prepare(`
      SELECT ${CATEGORY_SQL} AS category, SUM(${EXPENSE_SQL}) AS expenseCents
      FROM v_transactions
      WHERE substr(local_date, 1, 7) = ? AND ignored = 0 AND status != 'PENDING' AND kind IN ('expense', 'refund')
      GROUP BY 1 HAVING expenseCents != 0
      ORDER BY expenseCents DESC, category`)
    .all(month) as SummaryResponse["byCategory"];

  const first = `${month.slice(0, 4)}-01`;
  const rows = db
    .prepare(`
      SELECT substr(local_date, 1, 7) AS month, SUM(${EXPENSE_SQL}) AS expenseCents, SUM(${INCOME_SQL}) AS incomeCents
      FROM v_transactions
      WHERE local_date >= ? AND local_date < ? AND ignored = 0 AND status != 'PENDING'
      GROUP BY 1`)
    .all(`${first}-01`, `${addMonths(first, 12)}-01`) as SummaryResponse["monthly"];
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  const monthly = Array.from({ length: 12 }, (_, i) => {
    const m = addMonths(first, i);
    const r = byMonth.get(m);
    return { month: m, expenseCents: r?.expenseCents ?? 0, incomeCents: r?.incomeCents ?? 0 };
  });

  return {
    month,
    expenseCents: totals.expense,
    fixedExpenseCents: totals.fixed,
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
  connection_id: number;
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
  category_source: CategorySource;
  rule_id: number | null;
  provider_category: string | null;
  override_category: string | null;
  ignored: number;
  override_note: string | null;
  installment_number: number | null;
  total_installments: number | null;
  nature: Nature | null;
  nature_source: NatureSource | null;
  auto_nature: Nature | null;
}

export function accountLabel(type: "BANK" | "CREDIT", last4: string | null, name: string | null, id: number): string {
  if (last4) return `${type === "CREDIT" ? "Cartão" : "Conta"} ••••${last4}`;
  return name || `Conta ${id}`;
}

// O conector (MeuPluggy) não diz o banco; ele sai do nome das contas da conexão.
// Cartões têm nome de produto ("PLATINUM"), então valem pela conexão inteira.
export function bankFromName(name: string | null): Bank | null {
  if (!name) return null;
  if (/nu pagamentos|nubank/i.test(name)) return "nubank";
  if (/\binter\b/i.test(name)) return "inter";
  return null;
}

function banksByConnection(db: Db): Map<number, Bank> {
  const rows = db.prepare("SELECT connection_id, name FROM accounts ORDER BY id").all() as {
    connection_id: number;
    name: string | null;
  }[];
  const m = new Map<number, Bank>();
  for (const r of rows) {
    const bank = bankFromName(r.name);
    if (bank && !m.has(r.connection_id)) m.set(r.connection_id, bank);
  }
  return m;
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
      SELECT t.id, t.fingerprint, t.account_id, a.connection_id, a.type AS account_type, a.number_last4, a.name AS account_name,
        t.local_date, t.description, t.direction, t.amount_cents_abs, t.kind, t.status,
        ${CATEGORY_SQL} AS category, t.category_source, t.rule_id, t.provider_category_pt AS provider_category,
        t.override_category, t.ignored,
        t.override_note, t.installment_number, t.total_installments, t.nature, t.nature_source,
        CASE WHEN t.nature IS NOT NULL THEN COALESCE(t.auto_nature, 'variable') END AS auto_nature
      FROM v_transactions t JOIN accounts a ON a.id = t.account_id
      WHERE ${where.join(" AND ")}
      ORDER BY t.local_date DESC, t.date DESC, t.id DESC`)
    .all(...params) as TxRow[];
  const banks = banksByConnection(db);

  const items = rows.map(
    (r): TransactionRow => ({
      id: r.id,
      fingerprint: r.fingerprint,
      accountId: r.account_id,
      accountLabel: accountLabel(r.account_type, r.number_last4, r.account_name, r.account_id),
      bank: banks.get(r.connection_id) ?? null,
      localDate: r.local_date,
      description: r.description ?? "",
      amountCents: r.direction === "OUT" ? -r.amount_cents_abs : r.amount_cents_abs,
      kind: r.kind,
      status: r.status,
      category: r.category,
      categorySource: r.category_source,
      ruleId: r.rule_id,
      providerCategory: r.provider_category,
      overridden: r.override_category !== null,
      ignored: r.ignored === 1,
      note: r.override_note,
      installment:
        r.installment_number !== null && r.total_installments !== null
          ? { number: r.installment_number, total: r.total_installments }
          : null,
      nature: r.nature,
      natureSource: r.nature_source,
      autoNature: r.auto_nature,
    }),
  );
  return { items };
}

// Categorias efetivas das transações, as usadas por regras e as do fornecedor em pt-BR
// (mesmo sem transação ainda, para poderem ser escolhidas, ex.: "Moradia") e as próprias
export function listCategories(db: Db): CategoriesResponse {
  const rows = db
    .prepare(
      `SELECT ${CATEGORY_SQL} AS c FROM v_transactions
       UNION SELECT category FROM category_rules
       UNION SELECT name_pt FROM provider_categories WHERE TRIM(name_pt) <> ''`,
    )
    .all() as { c: string }[];
  const all = new Set([...rows.map((r) => r.c), ...EXTRA_CATEGORIES]);
  return { categories: [...all].sort((a, b) => a.localeCompare(b, "pt-BR")) };
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

// ---- Natureza (fixo/variável) ----

// Chave de recorrência de um gasto/estorno; undefined se não existir, null se não for marcável.
export function natureTarget(db: Db, fingerprint: string): { key: string | null } | undefined {
  const r = db
    .prepare("SELECT recurrence_key, kind FROM transactions WHERE fingerprint = ? LIMIT 1")
    .get(fingerprint) as { recurrence_key: string | null; kind: string | null } | undefined;
  if (!r) return undefined;
  return { key: r.kind === "expense" || r.kind === "refund" ? r.recurrence_key : null };
}

export function natureKeyExists(db: Db, key: string): boolean {
  return (
    db.prepare("SELECT 1 FROM transactions WHERE recurrence_key = ? AND kind IN ('expense', 'refund') LIMIT 1").get(key) !==
    undefined
  );
}

// Um item por chave com gasto. Linhas da mesma chave podem ter auto_nature diferente (parcela
// avulsa): a chave conta como detectada se qualquer uma for.
export function listNatures(db: Db): NaturesResponse {
  const rows = db
    .prepare(`
      SELECT recurrence_key AS key, description, ${CATEGORY_SQL} AS category, local_date, kind, amount_cents_abs,
        auto_nature, installment_number, total_installments, CASE WHEN nature_source = 'manual' THEN nature END AS mark
      FROM v_transactions
      WHERE recurrence_key IS NOT NULL AND kind IN ('expense', 'refund') AND ignored = 0
      ORDER BY local_date DESC, date DESC, id DESC`)
    .all() as {
    key: string;
    description: string | null;
    category: string;
    local_date: string;
    kind: "expense" | "refund";
    amount_cents_abs: number;
    auto_nature: Nature | null;
    installment_number: number | null;
    total_installments: number | null;
    mark: Nature | null;
  }[];

  const byKey = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byKey.get(r.key);
    if (list) list.push(r);
    else byKey.set(r.key, [r]);
  }

  const items: NatureEntry[] = [];
  for (const [key, txs] of byKey) {
    if (!txs.some((t) => t.kind === "expense")) continue;
    const last = txs[0]!;
    const months = new Map<string, number>();
    for (const t of txs) {
      const m = t.local_date.slice(0, 7);
      months.set(m, (months.get(m) ?? 0) + (t.kind === "expense" ? t.amount_cents_abs : -t.amount_cents_abs));
    }
    const autoNature: Nature = txs.some((t) => t.auto_nature === "fixed") ? "fixed" : "variable";
    items.push({
      recurrenceKey: key,
      description: last.description ?? "",
      category: last.category,
      nature: last.mark ?? autoNature,
      natureSource: last.mark ? "manual" : autoNature === "fixed" ? "detected" : "default",
      autoNature,
      installment:
        last.installment_number !== null && last.total_installments !== null && last.total_installments > 1
          ? { number: last.installment_number, total: last.total_installments }
          : null,
      lastDate: last.local_date,
      typicalCents: Math.round(median([...months.values()])),
      months: [...months].map(([month, amountCents]) => ({ month, amountCents })).reverse(),
      txCount: txs.length,
    });
  }
  return { items };
}

// Grava (ou apaga, com null) a marcação da chave; não precisa recalcular nada, a view junta na leitura.
export function saveNatureMark(db: Db, key: string, nature: Nature | null, now: Date): NatureResponse {
  if (nature === null) db.prepare("DELETE FROM nature_marks WHERE recurrence_key = ?").run(key);
  else
    db.prepare(`
      INSERT INTO nature_marks (recurrence_key, nature, created_at) VALUES (?, ?, ?)
      ON CONFLICT (recurrence_key) DO UPDATE SET nature = excluded.nature`).run(key, nature, now.toISOString());
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE recurrence_key = ?").get(key) as { n: number };
  return { recurrenceKey: key, nature, matchCount: n };
}

// ---- Regras de categorização ----

interface RuleRow {
  id: number;
  pattern: string;
  category: string;
  priority: number;
  enabled: number;
  created_at: string;
  match_count: number;
}

const RULE_SELECT = `
  SELECT r.id, r.pattern, r.category, r.priority, r.enabled, r.created_at,
    (SELECT COUNT(*) FROM transactions t WHERE t.rule_id = r.id) AS match_count
  FROM category_rules r`;

const toRule = (r: RuleRow): CategoryRule => ({
  id: r.id,
  pattern: r.pattern,
  category: r.category,
  priority: r.priority,
  enabled: r.enabled === 1,
  matchCount: r.match_count,
  createdAt: r.created_at,
});

export function listRules(db: Db): RulesResponse {
  const rows = db.prepare(`${RULE_SELECT} ORDER BY r.priority, r.id`).all() as RuleRow[];
  return { rules: rows.map(toRule) };
}

export function getRule(db: Db, id: number): CategoryRule | undefined {
  const r = db.prepare(`${RULE_SELECT} WHERE r.id = ?`).get(id) as RuleRow | undefined;
  return r && toRule(r);
}

export interface RuleInput {
  pattern: string;
  category: string;
  priority?: number;
  enabled: boolean;
}

// priority ausente = fim da lista (max + 10)
export function insertRule(db: Db, r: RuleInput, now: Date): number {
  const priority =
    r.priority ?? (db.prepare("SELECT COALESCE(MAX(priority), 0) + 10 AS p FROM category_rules").get() as { p: number }).p;
  return Number(
    db
      .prepare("INSERT INTO category_rules (pattern, category, priority, enabled, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(r.pattern, r.category, priority, r.enabled ? 1 : 0, now.toISOString()).lastInsertRowid,
  );
}

export function updateRule(db: Db, r: Omit<CategoryRule, "matchCount" | "createdAt">): void {
  db.prepare("UPDATE category_rules SET pattern = ?, category = ?, priority = ?, enabled = ? WHERE id = ?").run(
    r.pattern, r.category, r.priority, r.enabled ? 1 : 0, r.id,
  );
}

export function deleteRule(db: Db, id: number): boolean {
  return db.prepare("DELETE FROM category_rules WHERE id = ?").run(id).changes > 0;
}

export function ruleIds(db: Db): number[] {
  return (db.prepare("SELECT id FROM category_rules").all() as { id: number }[]).map((r) => r.id);
}

// Reatribui priority 10, 20, 30… na ordem de `ids` (o chamador garante que é o conjunto completo).
export function reorderRules(db: Db, ids: number[]): void {
  const update = db.prepare("UPDATE category_rules SET priority = ? WHERE id = ?");
  db.transaction(() => ids.forEach((id, i) => update.run((i + 1) * 10, id)))();
}

const PREVIEW_SAMPLE = 20;

// Testa um padrão (já validado) em todas as transações, no lugar de `excludeRuleId` ou no fim.
export function previewRule(db: Db, pattern: string, excludeRuleId?: number): RulePreviewResponse {
  const all = loadRules(db);
  const replaced = all.find((r) => r.id === excludeRuleId);
  const others = compileRules(all.filter((r) => r.id !== excludeRuleId && r.enabled));
  const last = others.reduce((max, r) => Math.max(max, r.priority), 0);
  // No lugar da regra editada herda a posição (priority e id) dela; senão vai para o fim
  const candidate: CompiledRule = {
    id: replaced?.id ?? Number.MAX_SAFE_INTEGER,
    pattern,
    category: "",
    priority: replaced?.priority ?? last + 10,
    enabled: true,
    re: compileRule(pattern),
  };
  const rules = [...others, candidate].sort(byPriority);

  const rows = db
    .prepare(`
      SELECT local_date, description, direction, amount_cents_abs, ${CATEGORY_SQL} AS category
      FROM v_transactions ORDER BY local_date DESC, date DESC, id DESC`)
    .all() as { local_date: string; description: string | null; direction: "IN" | "OUT"; amount_cents_abs: number; category: string }[];

  let matchCount = 0;
  const sample: RulePreviewResponse["sample"] = [];
  for (const r of rows) {
    if (matchRule(rules, r.description ?? "") !== candidate) continue;
    matchCount++;
    if (sample.length < PREVIEW_SAMPLE) {
      sample.push({
        localDate: r.local_date,
        description: r.description ?? "",
        amountCents: r.direction === "OUT" ? -r.amount_cents_abs : r.amount_cents_abs,
        currentCategory: r.category,
      });
    }
  }
  return { matchCount, sample };
}
