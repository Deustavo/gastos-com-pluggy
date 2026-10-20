import { test } from "node:test";
import assert from "node:assert/strict";
import { checkBills, summarizeIntegrity, type IntegrityBill, type IntegrityTx } from "../src/sync/integrity.ts";

const windowFrom = new Date("2025-10-01T00:00:00.000Z");

// Faturas sintéticas
const bills: IntegrityBill[] = [
  // ciclo começa em 2025-11-25 − 35d = 2025-10-21 → dentro da janela
  { externalId: "b-ok", dueDate: "2025-12-05T03:00:00.000Z", closingDate: "2025-11-25T03:00:00.000Z", totalCents: 8_500 },
  { externalId: "b-bad", dueDate: "2026-01-05T03:00:00.000Z", closingDate: "2025-12-26T03:00:00.000Z", totalCents: 10_000 },
  // sem closingDate: 2025-11-01 − 10d − 35d = 2025-09-17 → fora da janela
  { externalId: "b-old", dueDate: "2025-11-01T03:00:00.000Z", totalCents: 3_000 },
];

const txs: IntegrityTx[] = [
  { billId: "b-ok", direction: "OUT", amountCentsAbs: 6_000, kind: "expense" },
  { billId: "b-ok", direction: "OUT", amountCentsAbs: 4_000, kind: "expense" },
  { billId: "b-ok", direction: "IN", amountCentsAbs: 1_500, kind: "refund" }, // estorno abate
  { billId: "b-ok", direction: "IN", amountCentsAbs: 3_000, kind: "card_payment" }, // ignorado
  { billId: "b-bad", direction: "OUT", amountCentsAbs: 9_999, kind: "expense" },
  { billId: "b-old", direction: "OUT", amountCentsAbs: 3_000, kind: "expense" }, // bate, mas fora da janela
  { direction: "OUT", amountCentsAbs: 777, kind: "expense" }, // sem billId
];

test("checkBills: ok, mismatch e out_of_window", () => {
  const r = checkBills(bills, txs, windowFrom);
  assert.deepEqual(r, [
    { billId: "b-ok", status: "ok", expectedCents: 8_500, actualCents: 8_500 },
    { billId: "b-bad", status: "mismatch", expectedCents: 10_000, actualCents: 9_999 },
    { billId: "b-old", status: "out_of_window", expectedCents: 3_000, actualCents: 3_000 },
  ]);
});

test("checkBills: fronteira da janela pelo closingDate", () => {
  const bill: IntegrityBill = { externalId: "b", dueDate: "2025-11-15T03:00:00.000Z", closingDate: "2025-11-05T00:00:00.000Z", totalCents: 0 };
  // início do ciclo = 2025-10-01T00:00Z, igual a windowFrom → dentro
  assert.equal(checkBills([bill], [], windowFrom)[0]?.status, "ok");
  const earlier = { ...bill, closingDate: "2025-11-04T23:59:59.000Z" };
  assert.equal(checkBills([earlier], [], windowFrom)[0]?.status, "out_of_window");
});

test("checkBills: fatura sem transações e total > 0 → mismatch", () => {
  const bill: IntegrityBill = { externalId: "b", dueDate: "2026-03-10T03:00:00.000Z", totalCents: 100 };
  assert.deepEqual(checkBills([bill], [], windowFrom)[0], { billId: "b", status: "mismatch", expectedCents: 100, actualCents: 0 });
});

test("summarizeIntegrity conta por status", () => {
  assert.deepEqual(summarizeIntegrity(checkBills(bills, txs, windowFrom)), { ok: 1, mismatch: 1, outOfWindow: 1 });
  assert.deepEqual(summarizeIntegrity([]), { ok: 0, mismatch: 0, outOfWindow: 0 });
});
