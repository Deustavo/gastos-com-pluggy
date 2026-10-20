import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { openDb, SCHEMA_VERSION, seedConnections, type Db } from "../src/db/index.ts";
import type {
  Account,
  Bill,
  ConnectionStatus,
  DataProvider,
  DateRange,
  ProviderCategory,
  Transaction,
} from "../src/providers/types.ts";
import { fingerprint } from "../src/sync/fingerprint.ts";
import { SyncService, type SyncReport } from "../src/sync/sync.ts";

// Dados 100% sintéticos
const DAY_MS = 86_400_000;
const EARLY = new Date("2026-06-01T12:00:00.000Z"); // janela desde 2025-06-01
const NOW = new Date("2026-10-20T12:00:00.000Z"); // janela desde 2025-10-20

interface FakeItem {
  status: ConnectionStatus | Error;
  accounts: Account[];
  txs: Transaction[];
  bills: Bill[];
}

class FakeProvider implements DataProvider {
  constructor(private items: Record<string, FakeItem>) {}
  #item(id: string): FakeItem {
    const it = this.items[id];
    if (!it) throw new Error(`item desconhecido ${id}`);
    return it;
  }
  async getConnectionStatus(id: string): Promise<ConnectionStatus> {
    const s = this.#item(id).status;
    if (s instanceof Error) throw s;
    return s;
  }
  async listAccounts(id: string): Promise<Account[]> {
    return this.#item(id).accounts;
  }
  async *listTransactions(account: Account, range: DateRange): AsyncIterable<Transaction> {
    for (const it of Object.values(this.items)) {
      for (const tx of it.txs) {
        if (tx.accountExternalId === account.externalId && Date.parse(tx.date) >= range.from.getTime()) yield tx;
      }
    }
  }
  async listBills(account: Account): Promise<Bill[]> {
    return Object.values(this.items).flatMap((it) => it.bills.filter((b) => b.accountExternalId === account.externalId));
  }
}

const okStatus = (daysLeft: number): ConnectionStatus => ({
  ok: true,
  status: "UPDATED",
  lastUpdatedAt: new Date(NOW.getTime() - DAY_MS),
  consentExpiresAt: new Date(NOW.getTime() + daysLeft * DAY_MS),
});

const bank: Account = { externalId: "acc-bank", type: "BANK", subtype: "CHECKING_ACCOUNT", name: "Conta X", numberLast4: "1111", currency: "BRL", balanceCents: 0 };
const card: Account = { externalId: "acc-card", type: "CREDIT", subtype: "CREDIT_CARD", name: "Cartão Y", numberLast4: "2222", currency: "BRL", balanceCents: 0 };

let order = 0;
function tx(account: Account, date: string, amountCentsRaw: number, p: Partial<Transaction> = {}): Transaction {
  const out = account.type === "CREDIT" ? amountCentsRaw > 0 : amountCentsRaw < 0;
  return {
    externalId: `tx-${++order}`,
    accountExternalId: account.externalId,
    date,
    description: `Sintética ${order}`,
    amountCentsRaw,
    direction: out ? "OUT" : "IN",
    amountCentsAbs: Math.abs(amountCentsRaw),
    status: "POSTED",
    category: "Shopping",
    order,
    ...p,
  };
}

const oldBankTx = tx(bank, "2025-08-01T03:00:00.000Z", -1_234); // só visível na janela EARLY
const groceries = tx(bank, "2026-09-02T03:00:00.000Z", -4_500, { category: "Groceries" });
const billPayment = tx(bank, "2026-09-12T15:00:00.000Z", -50_000, { category: "Transfers" });
const salary = tx(bank, "2026-09-05T03:00:00.000Z", 900_000, { category: "Salary" });

const items: Record<string, FakeItem> = {
  "item-broken": { status: new Error("falha sintética de rede"), accounts: [], txs: [], bills: [] },
  "item-bank": { status: okStatus(400), accounts: [bank], txs: [oldBankTx, groceries, billPayment, salary], bills: [] },
  // cartão em OUTRA conexão: a fatura dele classifica o pagamento saído da conta
  "item-card": {
    status: okStatus(20),
    accounts: [card],
    txs: [
      tx(card, "2026-08-10T03:00:00.000Z", 30_000, { billId: "bill-sep" }),
      tx(card, "2026-08-20T03:00:00.000Z", 20_500, { billId: "bill-sep" }),
      tx(card, "2026-08-21T03:00:00.000Z", -500, { billId: "bill-sep" }), // estorno
      tx(card, "2026-10-01T03:00:00.000Z", 7_000, { status: "PENDING", billForecast: "2026-11" }),
    ],
    bills: [
      { externalId: "bill-sep", accountExternalId: "acc-card", dueDate: "2026-09-10T03:00:00.000Z", closingDate: "2026-09-01T03:00:00.000Z", totalCents: 50_000 },
    ],
  },
  "item-expired": {
    status: { ok: true, status: "UPDATED", consentExpiresAt: new Date(EARLY.getTime() - DAY_MS) },
    accounts: [{ ...bank, externalId: "acc-expired" }],
    txs: [],
    bills: [],
  },
  "item-login": {
    status: { ok: false, status: "LOGIN_ERROR", error: "credenciais inválidas" },
    accounts: [],
    txs: [],
    bills: [],
  },
};

function counts(db: Db): unknown {
  return {
    accounts: db.prepare("SELECT COUNT(*) AS n FROM accounts").get(),
    bills: db.prepare("SELECT COUNT(*) AS n FROM bills").get(),
    kinds: db.prepare("SELECT account_id, kind, COUNT(*) AS n FROM transactions GROUP BY 1, 2 ORDER BY 1, 2").all(),
  };
}

const conn = (r: SyncReport, i: number) => {
  const c = r.connections[i];
  assert.ok(c);
  return c;
};

test("sync de ponta a ponta com FakeProvider", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openfinance-sync-"));
  const db = openDb(path.join(dir, "app.db"));
  try {
    seedConnections(db, "fake", ["item-broken", "item-bank", "item-card", "item-expired", "item-login"]);
    const svc = new SyncService(db, { fake: new FakeProvider(items) });

    // 1ª execução numa data antiga: traz o histórico que depois sai da janela
    await svc.run({ now: EARLY });
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE fingerprint = ?").get(fingerprint(oldBankTx)) as { n: number }).n, 1);

    // overrides: um casa com transação, outro fica órfão
    db.prepare("INSERT INTO overrides (fingerprint, category, ignored) VALUES (?, 'Mercado', 1), ('orfao', 'X', 0)").run(fingerprint(groceries));

    const r1 = await svc.run({ now: NOW });
    const c1 = counts(db);
    const r2 = await svc.run({ now: NOW });

    // idempotência
    assert.deepEqual(counts(db), c1);
    assert.deepEqual(r2.integrity, r1.integrity);

    // conexão com erro não derruba as outras
    assert.equal(conn(r2, 0).status, "error");
    assert.match(conn(r2, 0).error ?? "", /falha sintética/);
    assert.equal(conn(r2, 1).status, "success");
    assert.equal(conn(r2, 2).status, "success");

    // consentimento expirado e alerta de expiração próxima
    assert.equal(conn(r2, 3).status, "error");
    assert.match(conn(r2, 3).error ?? "", /expirado/);
    assert.deepEqual(db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE external_id = 'acc-expired'").get(), { n: 0 });
    assert.ok(r2.alerts.some((a) => /expira em 20 dias/.test(a)));

    assert.equal(conn(r2, 4).status, "error");

    // sync_runs: 3 execuções × 5 conexões, nenhuma ficou 'running'
    const runs = db.prepare("SELECT status, COUNT(*) AS n FROM sync_runs GROUP BY status ORDER BY status").all();
    assert.deepEqual(runs, [{ status: "error", n: 9 }, { status: "success", n: 6 }]);

    // saúde da conexão: gravada sempre que o fornecedor responde (mesmo !ok); exceção não grava
    const health = db
      .prepare(`SELECT c.external_id, s.provider_status, s.last_updated_at, s.consent_expires_at, s.checked_at
        FROM connection_status s JOIN connections c ON c.id = s.connection_id ORDER BY c.id`)
      .all();
    assert.deepEqual(health, [
      { external_id: "item-bank", provider_status: "UPDATED", last_updated_at: "2026-10-19T12:00:00.000Z", consent_expires_at: "2027-11-24T12:00:00.000Z", checked_at: NOW.toISOString() },
      { external_id: "item-card", provider_status: "UPDATED", last_updated_at: "2026-10-19T12:00:00.000Z", consent_expires_at: "2026-11-09T12:00:00.000Z", checked_at: NOW.toISOString() },
      { external_id: "item-expired", provider_status: "UPDATED", last_updated_at: null, consent_expires_at: "2026-05-31T12:00:00.000Z", checked_at: NOW.toISOString() },
      { external_id: "item-login", provider_status: "LOGIN_ERROR", last_updated_at: null, consent_expires_at: null, checked_at: NOW.toISOString() },
    ]);

    // histórico fora da janela preservado
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE fingerprint = ?").get(fingerprint(oldBankTx)) as { n: number }).n, 1);
    const bankRep = conn(r2, 1).accounts[0];
    assert.equal(bankRep?.fetchedTx, 3);
    assert.equal(bankRep?.totalTx, 4);

    // pagamento na conta classificado pela fatura de outra conexão
    const kindOf = (t: Transaction) =>
      (db.prepare("SELECT kind FROM transactions WHERE fingerprint = ?").get(fingerprint(t)) as { kind: string }).kind;
    assert.equal(kindOf(billPayment), "card_payment");
    assert.equal(kindOf(groceries), "expense");
    assert.equal(kindOf(salary), "income");
    assert.deepEqual(bankRep?.byKind, { card_payment: 1, expense: 2, income: 1 });
    const cardRep = conn(r2, 2).accounts[0];
    assert.deepEqual(cardRep?.byKind, { expense: 3, refund: 1 });
    assert.equal(cardRep?.pendingTx, 1);

    // integridade do cartão
    assert.deepEqual(r2.integrity, [{ accountId: cardRep?.accountId, ok: 1, mismatch: 0, outOfWindow: 0, mismatches: [] }]);

    // override aplicado na view
    const v = db
      .prepare("SELECT category, effective_category, ignored FROM v_transactions WHERE fingerprint = ?")
      .get(fingerprint(groceries));
    assert.deepEqual(v, { category: "Groceries", effective_category: "Mercado", ignored: 1 });
    const plain = db.prepare("SELECT effective_category, ignored FROM v_transactions WHERE fingerprint = ?").get(fingerprint(salary));
    assert.deepEqual(plain, { effective_category: "Salary", ignored: 0 });
    assert.deepEqual(r2.overrides, { matched: 1, orphaned: 1 });

    // sem fingerprint duplicado nos dados sintéticos
    assert.ok(!r2.alerts.some((a) => /duplicado/.test(a)));
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- Fase 3: tradução, regras e migração ----

class FakeProviderWithCategories extends FakeProvider {
  calls = 0;
  constructor(itemsById: Record<string, FakeItem>, private categories: ProviderCategory[] | Error) {
    super(itemsById);
  }
  async listCategories(): Promise<ProviderCategory[]> {
    this.calls++;
    if (this.categories instanceof Error) throw this.categories;
    return this.categories;
  }
}

function withDb(fn: (db: Db, file: string) => Promise<void> | void): () => Promise<void> {
  return async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openfinance-f3-"));
    const file = path.join(dir, "app.db");
    const db = openDb(file);
    try {
      await fn(db, file);
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

const effective = (db: Db, t: Transaction) =>
  db.prepare("SELECT effective_category AS c, category_source AS s, provider_category_pt AS p FROM v_transactions WHERE fingerprint = ?").get(fingerprint(t));

test(
  "sync traduz categorias (1x por provider) e aplica regras no fim",
  withDb(async (db) => {
    seedConnections(db, "fake", ["item-bank", "item-card"]);
    const fake = new FakeProviderWithCategories(items, [
      { name: "Groceries", namePt: "Supermercado" },
      { name: "Salary", namePt: "" }, // sem tradução: fica o original
      { name: "", namePt: "Vazia" }, // ignorada
    ]);
    // regra criada antes do sync: casa sem acento com a descrição sintética
    db.prepare("INSERT INTO category_rules (pattern, category, priority, created_at) VALUES (?, ?, 10, ?)").run(
      `^sintetica ${groceries.order}$`, "Feira", NOW.toISOString(),
    );
    const r = await new SyncService(db, { fake }).run({ now: NOW });

    assert.equal(fake.calls, 1);
    assert.deepEqual(db.prepare("SELECT provider, name, name_pt FROM provider_categories ORDER BY name").all(), [
      { provider: "fake", name: "Groceries", name_pt: "Supermercado" },
      { provider: "fake", name: "Salary", name_pt: "Salary" },
    ]);
    assert.deepEqual(effective(db, groceries), { c: "Feira", s: "rule", p: "Supermercado" });
    assert.deepEqual(effective(db, salary), { c: "Salary", s: "provider", p: "Salary" });
    assert.deepEqual(effective(db, billPayment), { c: "Transfers", s: "provider", p: "Transfers" });
    // kind continua vindo da categoria do fornecedor
    assert.equal((db.prepare("SELECT kind FROM transactions WHERE fingerprint = ?").get(fingerprint(groceries)) as { kind: string }).kind, "expense");
    assert.deepEqual(r.alerts.filter((a) => /categorias/.test(a)), []);

    // novo sync reescreve as linhas: a regra é reaplicada
    await new SyncService(db, { fake }).run({ now: NOW });
    assert.deepEqual(effective(db, groceries), { c: "Feira", s: "rule", p: "Supermercado" });
    assert.deepEqual(db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE rule_id IS NOT NULL").get(), { n: 1 });
  }),
);

test(
  "listCategories falhando vira alerta e não derruba o sync",
  withDb(async (db) => {
    seedConnections(db, "fake", ["item-bank"]);
    const fake = new FakeProviderWithCategories(items, new Error("falha sintética nas categorias"));
    const r = await new SyncService(db, { fake }).run({ now: NOW });
    assert.equal(conn(r, 0).status, "success");
    assert.ok(r.alerts.some((a) => /categorias de fake: falha sintética/.test(a)));
    assert.deepEqual(effective(db, groceries), { c: "Groceries", s: "provider", p: "Groceries" });
  }),
);

// Schema da fase 2: tabelas base (schema.sql não muda mais; mudanças são migrações) e a view antiga
const PHASE2_VIEW = `
  CREATE VIEW v_transactions AS
  SELECT t.*, COALESCE(o.category, t.category) AS effective_category, COALESCE(o.ignored, 0) AS ignored,
    o.category AS override_category, o.note AS override_note
  FROM transactions t LEFT JOIN overrides o ON o.fingerprint = t.fingerprint;`;

const schemaOf = (db: Db) =>
  db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();

test("migração: banco da fase 2 e banco novo chegam ao mesmo schema; dados preservados", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openfinance-mig-"));
  try {
    const oldFile = path.join(dir, "old.db");
    const raw = new Database(oldFile);
    raw.exec(fs.readFileSync(path.join(import.meta.dirname, "../src/db/schema.sql"), "utf8"));
    raw.exec(PHASE2_VIEW);
    raw.exec(`
      INSERT INTO connections VALUES (1, 'fake', 'item-1', NULL, '2026-01-01T00:00:00.000Z');
      INSERT INTO accounts (id, connection_id, external_id, type) VALUES (1, 1, 'acc-1', 'BANK');
      INSERT INTO transactions (account_id, fingerprint, date, local_date, description, amount_cents_raw, direction,
        amount_cents_abs, status, category, kind, synced_at)
      VALUES (1, 'fp-old', '2026-09-01T15:00:00.000Z', '2026-09-01', 'Sintética antiga', -100, 'OUT', 100, 'POSTED', 'Shopping', 'expense', 'x');
      INSERT INTO overrides (fingerprint, category, ignored) VALUES ('fp-old', NULL, 1);`);
    assert.equal(raw.pragma("user_version", { simple: true }), 0);
    raw.close();

    const migrated = openDb(oldFile);
    const fresh = openDb(path.join(dir, "new.db"));
    try {
      assert.equal(SCHEMA_VERSION, 1);
      assert.equal(migrated.pragma("user_version", { simple: true }), SCHEMA_VERSION);
      assert.equal(fresh.pragma("user_version", { simple: true }), SCHEMA_VERSION);
      assert.deepEqual(schemaOf(migrated), schemaOf(fresh));
      const cols = (migrated.pragma("table_info(transactions)") as { name: string }[]).map((c) => c.name);
      assert.ok(cols.includes("rule_id") && cols.includes("rule_category"));

      assert.deepEqual(
        migrated.prepare("SELECT description, kind, effective_category, category_source, ignored, rule_id FROM v_transactions").all(),
        [{ description: "Sintética antiga", kind: "expense", effective_category: "Shopping", category_source: "provider", ignored: 1, rule_id: null }],
      );
    } finally {
      migrated.close();
      fresh.close();
    }

    // reabrir é idempotente
    const again = openDb(oldFile);
    try {
      assert.equal(again.pragma("user_version", { simple: true }), SCHEMA_VERSION);
      assert.deepEqual(again.prepare("SELECT COUNT(*) AS n FROM transactions").get(), { n: 1 });
    } finally {
      again.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
