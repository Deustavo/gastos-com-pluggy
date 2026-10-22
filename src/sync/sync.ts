// Orquestra o sync: provider → SQLite, reclassificação global e integridade.
// Sem saída de terminal: devolve um SyncReport (o CLI e a Fase 2 decidem como mostrar).

import { applyNature } from "../categorize/nature.ts";
import { applyRules } from "../categorize/rules.ts";
import type { Db } from "../db/index.ts";
import type { Account, AccountType, Bill, DataProvider, Direction, Transaction } from "../providers/types.ts";
import { classify, pairCardPayments, type BillRef, type Kind, type PairTx } from "./classify.ts";
import { toLocalDate } from "./dates.ts";
import { fingerprint } from "./fingerprint.ts";
import { checkBills, summarizeIntegrity, type IntegrityResult } from "./integrity.ts";

const DAY_MS = 86_400_000;
export const HISTORY_DAYS = 365;
export const CONSENT_WARN_DAYS = 30;

export interface AccountReport {
  accountId: number;
  type: AccountType;
  subtype: string;
  numberLast4?: string;
  fetchedTx: number;
  fetchedBills: number;
  // estado no banco após a reclassificação (inclui histórico fora da janela)
  totalTx: number;
  pendingTx: number;
  byKind: Partial<Record<Kind, number>>;
}

export interface ConnectionReport {
  connectionId: number;
  provider: string;
  status: "success" | "error";
  error?: string;
  consentExpiresAt?: string;
  daysToConsentExpiry?: number;
  txCount: number;
  accounts: AccountReport[];
}

export interface IntegrityReport {
  accountId: number;
  ok: number;
  mismatch: number;
  outOfWindow: number;
  mismatches: { billId: string; diffCents: number }[]; // diff = soma das compras − total da fatura
}

export interface SyncReport {
  startedAt: string;
  finishedAt: string;
  windowFrom: string;
  connections: ConnectionReport[];
  integrity: IntegrityReport[];
  overrides: { matched: number; orphaned: number };
  alerts: string[];
}

export interface SyncOptions {
  now?: Date; // injetável nos testes
}

interface ConnectionRow {
  id: number;
  provider: string;
  external_id: string;
}

interface FetchedAccount {
  account: Account;
  accountId: number;
  txs: Transaction[];
  bills: Bill[];
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export class SyncService {
  #db: Db;
  #providers: Record<string, DataProvider>;

  constructor(db: Db, providers: Record<string, DataProvider>) {
    this.#db = db;
    this.#providers = providers;
  }

  async run(opts: SyncOptions = {}): Promise<SyncReport> {
    const now = opts.now ?? new Date();
    const from = new Date(now.getTime() - HISTORY_DAYS * DAY_MS);
    const alerts: string[] = [];
    const conns = this.#db
      .prepare("SELECT id, provider, external_id FROM connections ORDER BY id")
      .all() as ConnectionRow[];

    const connections: ConnectionReport[] = [];
    for (const conn of conns) connections.push(await this.#syncConnection(conn, now, from, alerts));

    // Tradução das categorias: uma vez por provider em uso; falha vira alerta
    for (const name of new Set(conns.map((c) => c.provider))) await this.#syncCategories(name, alerts);

    this.#reclassifyAll();
    applyRules(this.#db);
    applyNature(this.#db);

    for (const c of connections) for (const a of c.accounts) Object.assign(a, this.#accountStats(a.accountId));

    const cardIds = connections
      .filter((c) => c.status === "success")
      .flatMap((c) => c.accounts.filter((a) => a.type === "CREDIT").map((a) => a.accountId));
    const integrity = cardIds.map((id) => this.#integrity(id, from));

    alerts.push(...this.#duplicateFingerprintAlerts());

    return {
      startedAt: now.toISOString(),
      finishedAt: new Date().toISOString(),
      windowFrom: from.toISOString(),
      connections,
      integrity,
      overrides: this.#overrideStats(),
      alerts,
    };
  }

  async #syncConnection(conn: ConnectionRow, now: Date, from: Date, alerts: string[]): Promise<ConnectionReport> {
    const db = this.#db;
    const runId = db
      .prepare("INSERT INTO sync_runs (connection_id, started_at, status) VALUES (?, ?, 'running')")
      .run(conn.id, now.toISOString()).lastInsertRowid;
    const finish = db.prepare("UPDATE sync_runs SET finished_at = ?, status = ?, error = ?, tx_count = ? WHERE id = ?");
    const report: ConnectionReport = {
      connectionId: conn.id,
      provider: conn.provider,
      status: "error",
      txCount: 0,
      accounts: [],
    };
    const fail = (error: string): ConnectionReport => {
      finish.run(new Date().toISOString(), "error", error, null, runId);
      report.error = error;
      return report;
    };

    try {
      const provider = this.#providers[conn.provider];
      if (!provider) return fail(`provider desconhecido: ${conn.provider}`);

      const status = await provider.getConnectionStatus(conn.external_id);
      db.prepare(`
        INSERT INTO connection_status (connection_id, provider_status, last_updated_at, consent_expires_at, checked_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (connection_id) DO UPDATE SET
          provider_status = excluded.provider_status, last_updated_at = excluded.last_updated_at,
          consent_expires_at = excluded.consent_expires_at, checked_at = excluded.checked_at`).run(
        conn.id, status.status, status.lastUpdatedAt?.toISOString() ?? null,
        status.consentExpiresAt?.toISOString() ?? null, now.toISOString(),
      );
      if (status.consentExpiresAt) {
        report.consentExpiresAt = status.consentExpiresAt.toISOString();
        report.daysToConsentExpiry = Math.floor((status.consentExpiresAt.getTime() - now.getTime()) / DAY_MS);
      }
      if (!status.ok) return fail(status.error ?? `status ${status.status}`);
      if (status.consentExpiresAt && status.consentExpiresAt <= now) return fail("consentimento expirado");
      if (report.daysToConsentExpiry !== undefined && report.daysToConsentExpiry < CONSENT_WARN_DAYS) {
        alerts.push(`conexão ${conn.id}: consentimento expira em ${report.daysToConsentExpiry} dias`);
      }

      const accounts = await provider.listAccounts(conn.external_id);
      const upsert = db.prepare(`
        INSERT INTO accounts (connection_id, external_id, type, subtype, name, number_last4, currency, balance_cents, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (external_id) DO UPDATE SET
          connection_id = excluded.connection_id, type = excluded.type, subtype = excluded.subtype,
          name = excluded.name, number_last4 = excluded.number_last4, currency = excluded.currency,
          balance_cents = excluded.balance_cents, updated_at = excluded.updated_at
        RETURNING id`);
      const syncedAt = new Date().toISOString();

      for (const account of accounts) {
        const { id } = upsert.get(
          conn.id, account.externalId, account.type, account.subtype, account.name,
          account.numberLast4 ?? null, account.currency, account.balanceCents, syncedAt,
        ) as { id: number };

        // Busca tudo antes de abrir a transação SQL (await não pode ficar dentro dela)
        const txs: Transaction[] = [];
        for await (const tx of provider.listTransactions(account, { from })) txs.push(tx);
        const bills = await provider.listBills(account);

        this.#replaceAccountData({ account, accountId: id, txs, bills }, from, syncedAt);
        report.txCount += txs.length;
        report.accounts.push({
          accountId: id,
          type: account.type,
          subtype: account.subtype,
          numberLast4: account.numberLast4,
          fetchedTx: txs.length,
          fetchedBills: bills.length,
          totalTx: 0,
          pendingTx: 0,
          byKind: {},
        });
      }

      finish.run(new Date().toISOString(), "success", null, report.txCount, runId);
      report.status = "success";
      return report;
    } catch (e) {
      return fail(errMsg(e));
    }
  }

  async #syncCategories(name: string, alerts: string[]): Promise<void> {
    const provider = this.#providers[name];
    if (!provider?.listCategories) return;
    try {
      const cats = await provider.listCategories();
      const upsert = this.#db.prepare(`
        INSERT INTO provider_categories (provider, name, name_pt) VALUES (?, ?, ?)
        ON CONFLICT (provider, name) DO UPDATE SET name_pt = excluded.name_pt`);
      this.#db.transaction(() => {
        for (const c of cats) {
          if (!c.name.trim()) continue;
          upsert.run(name, c.name, c.namePt.trim() || c.name);
        }
      })();
    } catch (e) {
      alerts.push(`categorias de ${name}: ${errMsg(e)}`);
    }
  }

  // Substitui a janela da conta e as faturas atomicamente; o mais antigo fica como histórico.
  #replaceAccountData(f: FetchedAccount, from: Date, syncedAt: string): void {
    const db = this.#db;
    // Se o fornecedor devolver algo antes de `from` (ex.: corte por dia), estende o corte
    // para não duplicar essas linhas no próximo sync.
    let cut = from.toISOString();
    for (const tx of f.txs) if (tx.date < cut) cut = tx.date;

    const insertTx = db.prepare(`
      INSERT INTO transactions (account_id, provider_tx_id, fingerprint, date, local_date, description,
        description_raw, amount_cents_raw, direction, amount_cents_abs, status, category, operation_type,
        bill_id, bill_forecast, installment_number, total_installments, kind, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`);
    const insertBill = db.prepare(`
      INSERT INTO bills (account_id, external_id, due_date, closing_date, total_cents, minimum_cents)
      VALUES (?, ?, ?, ?, ?, ?)`);

    db.transaction(() => {
      db.prepare("DELETE FROM transactions WHERE account_id = ? AND date >= ?").run(f.accountId, cut);
      for (const tx of f.txs) {
        insertTx.run(
          f.accountId, tx.externalId, fingerprint(tx), tx.date, toLocalDate(tx.date), tx.description,
          tx.descriptionRaw ?? null, tx.amountCentsRaw, tx.direction, tx.amountCentsAbs, tx.status,
          tx.category ?? null, tx.operationType ?? null, tx.billId ?? null, tx.billForecast ?? null,
          tx.installmentNumber ?? null, tx.totalInstallments ?? null, syncedAt,
        );
      }
      db.prepare("DELETE FROM bills WHERE account_id = ?").run(f.accountId);
      for (const b of f.bills) {
        insertBill.run(f.accountId, b.externalId, b.dueDate, b.closingDate ?? null, b.totalCents, b.minimumCents ?? null);
      }
    })();
  }

  // Global: o pagamento da fatura do banco B pode sair da conta do banco A.
  #reclassifyAll(): void {
    const db = this.#db;
    const bills = (
      db.prepare("SELECT external_id, due_date, total_cents FROM bills").all() as {
        external_id: string;
        due_date: string;
        total_cents: number;
      }[]
    ).map((b): BillRef => ({ externalId: b.external_id, dueLocalDate: toLocalDate(b.due_date), totalCents: b.total_cents }));

    const rows = db
      .prepare(`
        SELECT t.id, a.connection_id, a.type AS account_type, t.direction, t.amount_cents_abs, t.category, t.local_date, t.bill_id
        FROM transactions t JOIN accounts a ON a.id = t.account_id
        ORDER BY t.local_date, t.id`)
      .all() as {
      id: number;
      connection_id: number;
      account_type: AccountType;
      direction: Direction;
      amount_cents_abs: number;
      category: string | null;
      local_date: string;
      bill_id: string | null;
    }[];

    const classified: PairTx[] = rows.map((r) => ({
      id: r.id,
      connectionId: r.connection_id,
      accountType: r.account_type,
      direction: r.direction,
      amountCentsAbs: r.amount_cents_abs,
      localDate: r.local_date,
      kind: classify(
        {
          accountType: r.account_type,
          direction: r.direction,
          amountCentsAbs: r.amount_cents_abs,
          category: r.category ?? undefined,
          localDate: r.local_date,
          billId: r.bill_id ?? undefined,
        },
        bills,
      ),
    }));
    const paired = pairCardPayments(classified);

    const update = db.prepare("UPDATE transactions SET kind = ? WHERE id = ?");
    db.transaction(() => {
      for (const t of classified) update.run(paired.has(t.id) ? "card_payment" : t.kind, t.id);
    })();
  }

  #accountStats(accountId: number): Pick<AccountReport, "totalTx" | "pendingTx" | "byKind"> {
    const rows = this.#db
      .prepare(`
        SELECT kind, COUNT(*) AS n, SUM(status = 'PENDING') AS pending
        FROM transactions WHERE account_id = ? GROUP BY kind`)
      .all(accountId) as { kind: Kind; n: number; pending: number }[];
    const byKind: Partial<Record<Kind, number>> = {};
    let totalTx = 0;
    let pendingTx = 0;
    for (const r of rows) {
      byKind[r.kind] = r.n;
      totalTx += r.n;
      pendingTx += r.pending;
    }
    return { totalTx, pendingTx, byKind };
  }

  #integrity(accountId: number, from: Date): IntegrityReport {
    const db = this.#db;
    const bills = (
      db.prepare("SELECT external_id, due_date, closing_date, total_cents FROM bills WHERE account_id = ?").all(accountId) as {
        external_id: string;
        due_date: string;
        closing_date: string | null;
        total_cents: number;
      }[]
    ).map((b) => ({
      externalId: b.external_id,
      dueDate: b.due_date,
      closingDate: b.closing_date ?? undefined,
      totalCents: b.total_cents,
    }));
    const txs = (
      db.prepare("SELECT bill_id, direction, amount_cents_abs, kind FROM transactions WHERE account_id = ?").all(accountId) as {
        bill_id: string | null;
        direction: Direction;
        amount_cents_abs: number;
        kind: Kind;
      }[]
    ).map((t) => ({ billId: t.bill_id ?? undefined, direction: t.direction, amountCentsAbs: t.amount_cents_abs, kind: t.kind }));

    const results: IntegrityResult[] = checkBills(bills, txs, from);
    return {
      accountId,
      ...summarizeIntegrity(results),
      mismatches: results
        .filter((r) => r.status === "mismatch")
        .map((r) => ({ billId: r.billId, diffCents: r.actualCents - r.expectedCents })),
    };
  }

  #duplicateFingerprintAlerts(): string[] {
    const rows = this.#db
      .prepare(`
        SELECT account_id, COUNT(*) AS n FROM (
          SELECT account_id FROM transactions GROUP BY account_id, fingerprint HAVING COUNT(*) > 1
        ) GROUP BY account_id`)
      .all() as { account_id: number; n: number }[];
    return rows.map((r) => `conta ${r.account_id}: ${r.n} fingerprint(s) duplicado(s)`);
  }

  #overrideStats(): { matched: number; orphaned: number } {
    return this.#db
      .prepare(`
        SELECT
          COALESCE(SUM(EXISTS (SELECT 1 FROM transactions t WHERE t.fingerprint = o.fingerprint)), 0) AS matched,
          COALESCE(SUM(NOT EXISTS (SELECT 1 FROM transactions t WHERE t.fingerprint = o.fingerprint)), 0) AS orphaned
        FROM overrides o`)
      .get() as { matched: number; orphaned: number };
  }
}
