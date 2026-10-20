// Tipos normalizados, independentes de fornecedor. Todo provider (Pluggy, OFX...)
// converte seus dados para estes formatos; o resto do app só conhece estes tipos.

export type AccountType = "BANK" | "CREDIT";

export interface ConnectionStatus {
  ok: boolean;
  status: string;
  lastUpdatedAt?: Date;
  consentExpiresAt?: Date;
  error?: string;
}

export interface Account {
  externalId: string;
  type: AccountType;
  subtype: string;
  name: string;
  numberLast4?: string;
  currency: string;
  balanceCents: number;
}

// Sentido do dinheiro do ponto de vista do dono: OUT = saiu (compra, débito),
// IN = entrou (salário, estorno, pagamento de fatura no cartão).
// Cada provider resolve a convenção de sinal do seu fornecedor.
export type Direction = "IN" | "OUT";

export interface Transaction {
  externalId: string;
  accountExternalId: string;
  date: string; // ISO UTC, como veio do fornecedor
  description: string;
  descriptionRaw?: string;
  amountCentsRaw: number; // sinal original do fornecedor
  direction: Direction;
  amountCentsAbs: number;
  status: "POSTED" | "PENDING";
  category?: string;
  operationType?: string;
  billId?: string;
  billForecast?: string; // YYYY-MM
  installmentNumber?: number;
  totalInstallments?: number;
  order?: number; // posição estável informada pelo fornecedor; entra no fingerprint
}

export interface Bill {
  externalId: string;
  accountExternalId: string;
  dueDate: string; // ISO UTC
  closingDate?: string; // ISO UTC
  totalCents: number;
  minimumCents?: number;
}

export interface DateRange {
  from: Date;
  to?: Date;
}

export interface DataProvider {
  getConnectionStatus(externalId: string): Promise<ConnectionStatus>;
  listAccounts(externalId: string): Promise<Account[]>;
  listTransactions(account: Account, range: DateRange): AsyncIterable<Transaction>;
  listBills(account: Account): Promise<Bill[]>; // [] para contas que não são cartão
}
