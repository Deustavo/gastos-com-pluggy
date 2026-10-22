import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CARD_PAYMENT_TOLERANCE_DAYS,
  classify,
  isOwnTransferCategory,
  pairCardPayments,
  type BillRef,
  type ClassifyTx,
  type PairTx,
} from "../src/sync/classify.ts";

// Faturas sintéticas
const bills: BillRef[] = [
  { externalId: "bill-jan", dueLocalDate: "2026-01-10", totalCents: 50_000 },
  { externalId: "bill-feb", dueLocalDate: "2026-02-10", totalCents: 73_210 },
  { externalId: "bill-zero", dueLocalDate: "2026-03-10", totalCents: 0 },
];

function tx(p: Partial<ClassifyTx>): ClassifyTx {
  return { accountType: "BANK", direction: "OUT", amountCentsAbs: 1_000, localDate: "2026-02-05", ...p };
}

test("tolerância exportada é 10 dias", () => {
  assert.equal(CARD_PAYMENT_TOLERANCE_DAYS, 10);
});

test("isOwnTransferCategory", () => {
  assert.equal(isOwnTransferCategory("Investments"), true);
  assert.equal(isOwnTransferCategory("Fixed income"), true);
  assert.equal(isOwnTransferCategory("Same person transfer - PIX"), true);
  assert.equal(isOwnTransferCategory("Same person transfer"), true);
  assert.equal(isOwnTransferCategory("Transfers"), false);
  assert.equal(isOwnTransferCategory("investments"), false);
  assert.equal(isOwnTransferCategory(undefined), false);
});

test("CREDIT + OUT → expense", () => {
  assert.equal(classify(tx({ accountType: "CREDIT", direction: "OUT", amountCentsAbs: 50_000 }), bills), "expense");
});

test("CREDIT + IN igual a fatura anterior perto do vencimento → card_payment", () => {
  const t = tx({ accountType: "CREDIT", direction: "IN", amountCentsAbs: 73_210, localDate: "2026-02-10", billId: "bill-mar" });
  assert.equal(classify(t, bills), "card_payment");
});

test("CREDIT + IN com o próprio billId não vira card_payment", () => {
  const t = tx({ accountType: "CREDIT", direction: "IN", amountCentsAbs: 73_210, localDate: "2026-02-10", billId: "bill-feb" });
  assert.equal(classify(t, bills), "refund");
});

test("CREDIT + IN sem fatura correspondente → refund", () => {
  const t = tx({ accountType: "CREDIT", direction: "IN", amountCentsAbs: 1_999, billId: "bill-mar" });
  assert.equal(classify(t, bills), "refund");
});

test("CREDIT + IN fora da tolerância → refund", () => {
  const t = tx({ accountType: "CREDIT", direction: "IN", amountCentsAbs: 73_210, localDate: "2026-02-21", billId: "bill-mar" });
  assert.equal(classify(t, bills), "refund");
});

test("BANK + OUT igual a fatura, mesmo com categoria Transfers → card_payment", () => {
  assert.equal(classify(tx({ amountCentsAbs: 50_000, localDate: "2026-01-09", category: "Transfers" }), bills), "card_payment");
});

test("BANK + OUT card_payment tem prioridade sobre categoria própria", () => {
  assert.equal(classify(tx({ amountCentsAbs: 50_000, localDate: "2026-01-10", category: "Same person transfer - PIX" }), bills), "card_payment");
});

test("fronteira: 10 dias casa, 11 não", () => {
  assert.equal(classify(tx({ amountCentsAbs: 73_210, localDate: "2026-02-20" }), bills), "card_payment");
  assert.equal(classify(tx({ amountCentsAbs: 73_210, localDate: "2026-01-31" }), bills), "card_payment");
  assert.equal(classify(tx({ amountCentsAbs: 73_210, localDate: "2026-02-21" }), bills), "expense");
  assert.equal(classify(tx({ amountCentsAbs: 73_210, localDate: "2026-01-30" }), bills), "expense");
});

test("fatura zerada nunca casa", () => {
  assert.equal(classify(tx({ amountCentsAbs: 0, localDate: "2026-03-10" }), bills), "expense");
  const c = tx({ accountType: "CREDIT", direction: "IN", amountCentsAbs: 0, localDate: "2026-03-10", billId: "x" });
  assert.equal(classify(c, bills), "refund");
});

test("BANK + OUT categoria própria/investimento → transfer", () => {
  assert.equal(classify(tx({ category: "Same person transfer - PIX" }), bills), "transfer");
  assert.equal(classify(tx({ category: "Investments" }), bills), "transfer");
  assert.equal(classify(tx({ category: "Fixed income" }), bills), "transfer");
});

test("BANK + OUT outros → expense", () => {
  assert.equal(classify(tx({ category: "Groceries" }), bills), "expense");
  assert.equal(classify(tx({}), []), "expense");
});

test("BANK + IN categoria própria → transfer", () => {
  assert.equal(classify(tx({ direction: "IN", category: "Same person transfer - PIX" }), bills), "transfer");
  assert.equal(classify(tx({ direction: "IN", category: "Fixed income" }), bills), "transfer");
});

test("BANK + IN outros → income (mesmo com valor de fatura)", () => {
  assert.equal(classify(tx({ direction: "IN", category: "Salary" }), bills), "income");
  assert.equal(classify(tx({ direction: "IN", amountCentsAbs: 50_000, localDate: "2026-01-10" }), bills), "income");
});

// ---- pagamento parcial de fatura (pareamento cartão × conta) ----

function ptx(p: Partial<PairTx> & { id: number }): PairTx {
  return { connectionId: 1, accountType: "BANK", direction: "OUT", amountCentsAbs: 5_830, localDate: "2026-06-24", kind: "expense", ...p };
}
const cardIn = (p: Partial<PairTx> & { id: number }) =>
  ptx({ accountType: "CREDIT", direction: "IN", kind: "refund", ...p });

test("pairCardPayments: estorno no cartão + gasto na conta, mesmo valor e dia → par", () => {
  const got = pairCardPayments([cardIn({ id: 1 }), ptx({ id: 2 }), ptx({ id: 3, amountCentsAbs: 5_831 })]);
  assert.deepEqual([...got].sort(), [1, 2]);
});

test("pairCardPayments: 1:1 e prefere o mais próximo", () => {
  const got = pairCardPayments([
    cardIn({ id: 1 }),
    ptx({ id: 2, localDate: "2026-06-25" }),
    ptx({ id: 3 }),
    ptx({ id: 4 }),
  ]);
  assert.deepEqual([...got].sort(), [1, 3]);
});

test("pairCardPayments: não pareia outra conexão, data distante nem kind diferente", () => {
  assert.equal(pairCardPayments([cardIn({ id: 1 }), ptx({ id: 2, connectionId: 2 })]).size, 0);
  assert.equal(pairCardPayments([cardIn({ id: 1 }), ptx({ id: 2, localDate: "2026-06-26" })]).size, 0);
  assert.equal(pairCardPayments([cardIn({ id: 1 }), ptx({ id: 2, kind: "transfer" })]).size, 0);
  assert.equal(pairCardPayments([cardIn({ id: 1, kind: "card_payment" }), ptx({ id: 2 })]).size, 0);
  assert.equal(pairCardPayments([ptx({ id: 1, direction: "IN", kind: "income" }), ptx({ id: 2 })]).size, 0);
});
