// Adapta a API da Pluggy para os tipos normalizados de ../types.ts.

import type {
  Account,
  Bill,
  ConnectionStatus,
  DataProvider,
  DateRange,
  Direction,
  ProviderCategory,
  Transaction,
} from "../types.ts";
import type {
  PluggyAccount,
  PluggyBill,
  PluggyCategory,
  PluggyClient,
  PluggyItem,
  PluggyTransaction,
} from "./client.ts";

const OK_EXECUTION_STATUSES = new Set(["SUCCESS", "PARTIAL_SUCCESS"]);
// Exigem ação do usuário (reconectar, renovar consentimento etc.).
const BROKEN_STATUSES = new Set(["LOGIN_ERROR", "OUTDATED", "WAITING_USER_INPUT"]);

// Valores da Pluggy vêm em reais com ponto flutuante; arredonda para não perder centavo.
const toCents = (value: number): number => Math.round(value * 100);
const toDate = (iso?: string): Date | undefined => (iso ? new Date(iso) : undefined);

export class PluggyProvider implements DataProvider {
  #client: PluggyClient;

  constructor(client: PluggyClient) {
    this.#client = client;
  }

  async getConnectionStatus(itemId: string): Promise<ConnectionStatus> {
    return toConnectionStatus(await this.#client.getItem(itemId));
  }

  async listAccounts(itemId: string): Promise<Account[]> {
    return (await this.#client.listAccounts(itemId)).map(toAccount);
  }

  async *listTransactions(account: Account, range: DateRange): AsyncIterable<Transaction> {
    const txs = this.#client.listTransactions(account.externalId, { dateFrom: range.from, dateTo: range.to });
    for await (const tx of txs) yield toTransaction(tx, account);
  }

  async listBills(account: Account): Promise<Bill[]> {
    if (account.type !== "CREDIT") return [];
    return (await this.#client.listBills(account.externalId)).map((b) => toBill(b, account));
  }

  async listCategories(): Promise<ProviderCategory[]> {
    return (await this.#client.listCategories()).map(toProviderCategory);
  }
}

// Sem tradução, fica o texto original.
export function toProviderCategory(c: PluggyCategory): ProviderCategory {
  return { name: c.description, namePt: c.descriptionTranslated?.trim() || c.description };
}

export function toConnectionStatus(item: PluggyItem): ConnectionStatus {
  const ok =
    !item.error &&
    !BROKEN_STATUSES.has(item.status) &&
    (item.status === "UPDATED" || OK_EXECUTION_STATUSES.has(item.executionStatus));
  const error =
    item.error?.message ?? item.error?.code ?? (ok ? undefined : `${item.status}/${item.executionStatus}`);
  return {
    ok,
    status: item.status,
    lastUpdatedAt: toDate(item.lastUpdatedAt),
    consentExpiresAt: toDate(item.consentExpiresAt),
    error,
  };
}

export function toAccount(acc: PluggyAccount): Account {
  return {
    externalId: acc.id,
    type: acc.type,
    subtype: acc.subtype,
    name: acc.marketingName ?? acc.name,
    numberLast4: acc.number ? acc.number.replace(/\D/g, "").slice(-4) : undefined,
    currency: acc.currencyCode,
    balanceCents: toCents(acc.balance),
  };
}

// Convenção de sinal validada no spike: na conta, amount < 0 é saída; no cartão,
// amount > 0 é compra (saída) e amount < 0 é estorno/pagamento (entrada).
export function directionOf(accountType: Account["type"], amount: number): Direction {
  if (accountType === "CREDIT") return amount > 0 ? "OUT" : "IN";
  return amount < 0 ? "OUT" : "IN";
}

export function toTransaction(tx: PluggyTransaction, account: Account): Transaction {
  const amountCentsRaw = toCents(tx.amount);
  const card = tx.creditCardMetadata;
  return {
    externalId: tx.id,
    accountExternalId: account.externalId,
    date: tx.date,
    description: tx.description,
    descriptionRaw: tx.descriptionRaw ?? undefined,
    amountCentsRaw,
    direction: directionOf(account.type, tx.amount),
    amountCentsAbs: Math.abs(amountCentsRaw),
    status: tx.status ?? "POSTED",
    category: tx.category,
    operationType: tx.operationType ?? undefined,
    billId: card?.billId,
    billForecast: card?.billForecastDate?.slice(0, 7),
    installmentNumber: card?.installmentNumber,
    totalInstallments: card?.totalInstallments,
    order: tx.order,
  };
}

export function toBill(bill: PluggyBill, account: Account): Bill {
  return {
    externalId: bill.id,
    accountExternalId: account.externalId,
    dueDate: bill.dueDate,
    closingDate: bill.billClosingDate,
    totalCents: toCents(bill.totalAmount),
    minimumCents: bill.minimumPaymentAmount == null ? undefined : toCents(bill.minimumPaymentAmount),
  };
}
