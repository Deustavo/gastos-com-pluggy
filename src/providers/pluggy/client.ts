// Cliente somente leitura da API da Pluggy.
// O único POST é a troca de credenciais por API key; todo o resto é GET
// restrito a ALLOWED_READ_PATHS. Não existe método genérico de request de propósito.

const BASE_URL = "https://api.pluggy.ai";

// A API key vale 2h; renovamos com 10min de folga.
const API_KEY_TTL_MS = 110 * 60 * 1000;
const MAX_RETRIES_ON_429 = 3;

const ALLOWED_READ_PATHS = [
  /^\/items\/[\w-]+$/,
  /^\/accounts$/,
  /^\/v2\/transactions$/,
  /^\/bills$/,
  /^\/categories$/, // só a lista (tradução); /categories/rules NUNCA: as regras são locais
];

export interface PluggyItem {
  id: string;
  status: string;
  executionStatus: string;
  lastUpdatedAt?: string;
  consentExpiresAt?: string;
  products?: string[];
  error?: { code?: string; message?: string };
  connector?: { id: number; name: string; isOpenFinance?: boolean };
}

export interface PluggyAccount {
  id: string;
  itemId: string;
  type: "BANK" | "CREDIT";
  subtype: string;
  name: string;
  marketingName?: string;
  number?: string;
  balance: number;
  currencyCode: string;
  creditData?: {
    balanceCloseDate?: string;
    balanceDueDate?: string;
    creditLimit?: number;
    availableCreditLimit?: number;
  };
}

export interface PluggyTransaction {
  id: string;
  accountId: string;
  date: string;
  description: string;
  descriptionRaw?: string | null;
  amount: number;
  currencyCode: string;
  type?: "DEBIT" | "CREDIT";
  status?: "POSTED" | "PENDING";
  category?: string;
  categoryId?: string;
  operationType?: string | null;
  providerId?: string | null;
  order?: number;
  creditCardMetadata?: {
    installmentNumber?: number;
    totalInstallments?: number;
    purchaseDate?: string;
    billId?: string;
    billForecastDate?: string;
    paymentType?: "SINGLE" | "INSTALLMENT";
  };
}

export interface PluggyCategory {
  id: string;
  description: string;
  descriptionTranslated?: string | null;
  parentId?: string | null;
  parentDescription?: string | null;
}

export interface PluggyBill {
  id: string;
  dueDate: string;
  billClosingDate?: string;
  totalAmount: number;
  totalAmountCurrencyCode: string;
  minimumPaymentAmount?: number;
}

interface PageResponse<T> {
  page: number;
  totalPages: number;
  total: number;
  results: T[];
}

interface CursorPageResponse<T> {
  results: T[];
  next: string | null;
}

export class PluggyClient {
  #clientId: string;
  #clientSecret: string;
  #apiKey?: string;
  #apiKeyExpiresAt = 0;

  constructor(clientId: string, clientSecret: string) {
    this.#clientId = clientId;
    this.#clientSecret = clientSecret;
  }

  getItem(itemId: string): Promise<PluggyItem> {
    return this.#get(`/items/${encodeURIComponent(itemId)}`);
  }

  async listAccounts(itemId: string): Promise<PluggyAccount[]> {
    const res = await this.#get<PageResponse<PluggyAccount>>(`/accounts?itemId=${encodeURIComponent(itemId)}`);
    return res.results;
  }

  async *listTransactions(
    accountId: string,
    range: { dateFrom?: Date; dateTo?: Date } = {},
  ): AsyncGenerator<PluggyTransaction> {
    const params = new URLSearchParams({ accountId });
    if (range.dateFrom) params.set("dateFrom", range.dateFrom.toISOString());
    if (range.dateTo) params.set("dateTo", range.dateTo.toISOString());

    // `next` já vem como query string pronta (com o cursor opaco `after`).
    let query: string | null = `?${params}`;
    while (query) {
      const page: CursorPageResponse<PluggyTransaction> = await this.#get(`/v2/transactions${query}`);
      yield* page.results;
      query = page.next;
    }
  }

  async listBills(accountId: string): Promise<PluggyBill[]> {
    const bills: PluggyBill[] = [];
    for (let page = 1; ; page++) {
      const params = new URLSearchParams({ accountId, pageSize: "500", page: String(page) });
      const res = await this.#get<PageResponse<PluggyBill>>(`/bills?${params}`);
      bills.push(...res.results);
      if (page >= res.totalPages) return bills;
    }
  }

  async listCategories(): Promise<PluggyCategory[]> {
    const categories: PluggyCategory[] = [];
    for (let page = 1; ; page++) {
      const res = await this.#get<PageResponse<PluggyCategory>>(page === 1 ? "/categories" : `/categories?page=${page}`);
      categories.push(...res.results);
      if (page >= (res.totalPages ?? 1)) return categories;
    }
  }

  async #get<T>(pathWithQuery: string): Promise<T> {
    const url = new URL(pathWithQuery, BASE_URL);
    if (url.origin !== BASE_URL || !ALLOWED_READ_PATHS.some((re) => re.test(url.pathname))) {
      throw new Error(`Caminho não permitido pelo cliente somente leitura: ${url.pathname}`);
    }

    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, {
        method: "GET",
        headers: { "X-API-KEY": await this.#getApiKey(), Accept: "application/json" },
      });
      if (res.status === 429 && attempt < MAX_RETRIES_ON_429) {
        const retryAfterSeconds = Number(res.headers.get("retry-after")) || 2 ** attempt;
        await new Promise((r) => setTimeout(r, retryAfterSeconds * 1000));
        continue;
      }
      if (!res.ok) {
        throw new Error(`Pluggy GET ${url.pathname} falhou: ${res.status} ${await res.text()}`);
      }
      return (await res.json()) as T;
    }
  }

  async #getApiKey(): Promise<string> {
    if (this.#apiKey && Date.now() < this.#apiKeyExpiresAt) return this.#apiKey;

    const res = await fetch(`${BASE_URL}/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: this.#clientId, clientSecret: this.#clientSecret }),
    });
    if (!res.ok) {
      // Não ecoa o corpo da requisição para não vazar o secret em log.
      throw new Error(`Pluggy POST /auth falhou: ${res.status} ${await res.text()}`);
    }
    const { apiKey } = (await res.json()) as { apiKey: string };
    this.#apiKey = apiKey;
    this.#apiKeyExpiresAt = Date.now() + API_KEY_TTL_MS;
    return apiKey;
  }
}
