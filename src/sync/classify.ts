import type { AccountType, Direction } from "../providers/types.ts";
import { daysBetween } from "./dates.ts";

export type Kind = "expense" | "income" | "transfer" | "card_payment" | "refund";

export interface ClassifyTx {
  accountType: AccountType;
  direction: Direction;
  amountCentsAbs: number;
  category?: string;
  localDate: string; // YYYY-MM-DD
  billId?: string;
}

export interface BillRef {
  externalId: string;
  dueLocalDate: string; // YYYY-MM-DD
  totalCents: number;
}

// Distância máxima (dias) entre o pagamento e o vencimento da fatura
export const CARD_PAYMENT_TOLERANCE_DAYS = 10;

// Transferência entre contas próprias ou movimentação de investimento
export function isOwnTransferCategory(category?: string): boolean {
  if (!category) return false;
  return (
    category === "Investments" ||
    category === "Fixed income" ||
    category === "Variable income" ||
    category.startsWith("Same person transfer")
  );
}

function matchesBill(tx: ClassifyTx, bill: BillRef): boolean {
  return (
    bill.totalCents > 0 && // fatura zerada nunca casa
    bill.totalCents === tx.amountCentsAbs &&
    daysBetween(tx.localDate, bill.dueLocalDate) <= CARD_PAYMENT_TOLERANCE_DAYS
  );
}

export function classify(tx: ClassifyTx, bills: BillRef[]): Kind {
  if (tx.accountType === "CREDIT") {
    if (tx.direction === "OUT") return "expense";
    // pagamento quita uma fatura anterior, nunca a própria
    const paysBill = bills.some((b) => b.externalId !== tx.billId && matchesBill(tx, b));
    return paysBill ? "card_payment" : "refund";
  }

  // BANK: pagamento de fatura antes da categoria (vem como "Transfers")
  if (tx.direction === "OUT" && bills.some((b) => matchesBill(tx, b))) return "card_payment";
  if (isOwnTransferCategory(tx.category)) return "transfer";
  return tx.direction === "OUT" ? "expense" : "income";
}

// Pagamento parcial/antecipado de fatura: o valor não bate com nenhuma fatura, então sai
// como "estorno" no cartão e "gasto" na conta. Se os dois estão na mesma conexão, com o
// mesmo valor e até PAIR_TOLERANCE_DAYS de distância, viram card_payment (pareamento 1:1).
export const PAIR_TOLERANCE_DAYS = 1;

export interface PairTx {
  id: number;
  connectionId: number;
  accountType: AccountType;
  direction: Direction;
  amountCentsAbs: number;
  localDate: string; // YYYY-MM-DD
  kind: Kind;
}

// Devolve os ids (dos dois lados) que devem virar card_payment
export function pairCardPayments(txs: PairTx[]): Set<number> {
  const bankOut = txs.filter((t) => t.accountType !== "CREDIT" && t.direction === "OUT" && t.kind === "expense");
  const paired = new Set<number>();
  for (const c of txs) {
    if (c.accountType !== "CREDIT" || c.direction !== "IN" || c.kind !== "refund") continue;
    let best: PairTx | undefined;
    for (const b of bankOut) {
      if (paired.has(b.id) || b.connectionId !== c.connectionId || b.amountCentsAbs !== c.amountCentsAbs) continue;
      const d = daysBetween(b.localDate, c.localDate);
      if (d <= PAIR_TOLERANCE_DAYS && (!best || d < daysBetween(best.localDate, c.localDate))) best = b;
    }
    if (best) {
      paired.add(c.id);
      paired.add(best.id);
    }
  }
  return paired;
}
