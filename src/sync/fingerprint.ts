import { createHash } from "node:crypto";
import type { Transaction } from "../providers/types.ts";

// Identidade estável da transação: sobrevive a re-syncs e liga os overrides
export function fingerprint(
  tx: Pick<Transaction, "date" | "amountCentsRaw" | "description" | "order">,
): string {
  const key = `${tx.date}|${tx.amountCentsRaw}|${tx.description}|${tx.order ?? ""}`;
  return createHash("sha256").update(key).digest("hex");
}
