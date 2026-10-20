import type { Direction } from "../providers/types.ts";
import type { Kind } from "./classify.ts";

export interface IntegrityTx {
  billId?: string;
  direction: Direction;
  amountCentsAbs: number;
  kind: Kind;
}

export interface IntegrityBill {
  externalId: string;
  dueDate: string; // ISO UTC
  closingDate?: string; // ISO UTC
  totalCents: number;
}

export type IntegrityStatus = "ok" | "mismatch" | "out_of_window";

export interface IntegrityResult {
  billId: string;
  status: IntegrityStatus;
  expectedCents: number;
  actualCents: number;
}

const DAY_MS = 86_400_000;
const DUE_TO_CLOSING_DAYS = 10; // estimativa quando falta closingDate
const CYCLE_DAYS = 35; // margem para o início do ciclo da fatura

// Início estimado do ciclo de compras da fatura
function cycleStart(bill: IntegrityBill): number {
  const closing = bill.closingDate
    ? Date.parse(bill.closingDate)
    : Date.parse(bill.dueDate) - DUE_TO_CLOSING_DAYS * DAY_MS;
  return closing - CYCLE_DAYS * DAY_MS;
}

// Soma das compras de cada fatura (estornos abatem, pagamentos ficam de fora)
export function checkBills(
  bills: IntegrityBill[],
  txs: IntegrityTx[],
  windowFrom: Date,
): IntegrityResult[] {
  const sums = new Map<string, number>();
  for (const tx of txs) {
    if (!tx.billId || tx.kind === "card_payment") continue;
    const signed = tx.direction === "OUT" ? tx.amountCentsAbs : -tx.amountCentsAbs;
    sums.set(tx.billId, (sums.get(tx.billId) ?? 0) + signed);
  }

  return bills.map((bill) => {
    const actualCents = sums.get(bill.externalId) ?? 0;
    const status: IntegrityStatus =
      cycleStart(bill) < windowFrom.getTime()
        ? "out_of_window"
        : actualCents === bill.totalCents
          ? "ok"
          : "mismatch";
    return { billId: bill.externalId, status, expectedCents: bill.totalCents, actualCents };
  });
}

export function summarizeIntegrity(results: IntegrityResult[]): {
  ok: number;
  mismatch: number;
  outOfWindow: number;
} {
  const s = { ok: 0, mismatch: 0, outOfWindow: 0 };
  for (const r of results) {
    if (r.status === "ok") s.ok++;
    else if (r.status === "mismatch") s.mismatch++;
    else s.outOfWindow++;
  }
  return s;
}
