import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb, seedConnections, type Db } from "../src/db/index.ts";
import type { Account, Bill, ConnectionStatus, DataProvider, DateRange, Transaction } from "../src/providers/types.ts";
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
    seedConnections(db, "fake", ["item-broken", "item-bank", "item-card", "item-expired"]);
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

    // sync_runs: 3 execuções × 4 conexões, nenhuma ficou 'running'
    const runs = db.prepare("SELECT status, COUNT(*) AS n FROM sync_runs GROUP BY status ORDER BY status").all();
    assert.deepEqual(runs, [{ status: "error", n: 6 }, { status: "success", n: 6 }]);

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
