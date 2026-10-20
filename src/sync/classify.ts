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
