// Cliente HTTP tipado da API local. Os tipos vêm do contrato (só `import type`).

import type {
  ApiError,
  CategoriesResponse,
  ConnectionsResponse,
  NatureRequest,
  NatureResponse,
  OverrideRequest,
  CategoryRule,
  OverrideResponse,
  RuleCreateRequest,
  RulePreviewRequest,
  RulePreviewResponse,
  RulesResponse,
  RuleUpdateRequest,
  SummaryResponse,
  SyncResponse,
  TransactionsResponse,
} from "../../src/api/contract.ts";

// Mesmo limite da API (MAX_CATEGORY_LENGTH em src/categorize/categories.ts)
export const MAX_CATEGORY = 60;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

async function request<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: { Accept: "application/json" } };
  if (method === "POST" || method === "PATCH") {
    init.headers = { Accept: "application/json", "Content-Type": "application/json" };
    init.body = JSON.stringify(body ?? {});
  }
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new HttpError(0, "Não foi possível falar com a API local (ela está rodando?)");
  }
  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  }
  if (!res.ok) {
    const msg =
      data && typeof data === "object" && typeof (data as Partial<ApiError>).error === "string"
        ? (data as ApiError).error
        : `HTTP ${res.status}`;
    throw new HttpError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  if (data === undefined) throw new HttpError(res.status, "Resposta inválida da API");
  return data as T;
}

function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export interface TransactionFilters {
  month: string;
  category?: string;
  account?: number;
  status?: "POSTED" | "PENDING";
  kind?: string;
}

export const api = {
  summary: (month: string) => request<SummaryResponse>("GET", `/api/summary${qs({ month })}`),
  transactions: (f: TransactionFilters) => request<TransactionsResponse>("GET", `/api/transactions${qs({ ...f })}`),
  categories: () => request<CategoriesResponse>("GET", "/api/categories"),
  connections: () => request<ConnectionsResponse>("GET", "/api/connections"),
  override: (fingerprint: string, body: OverrideRequest) =>
    request<OverrideResponse>("PATCH", `/api/overrides/${encodeURIComponent(fingerprint)}`, body),
  nature: (fingerprint: string, body: NatureRequest) =>
    request<NatureResponse>("PATCH", `/api/natures/${encodeURIComponent(fingerprint)}`, body),
  sync: () => request<SyncResponse>("POST", "/api/sync"),
  rules: () => request<RulesResponse>("GET", "/api/rules"),
  createRule: (body: RuleCreateRequest) => request<CategoryRule>("POST", "/api/rules", body),
  updateRule: (id: number, body: RuleUpdateRequest) => request<CategoryRule>("PATCH", `/api/rules/${id}`, body),
  deleteRule: (id: number) => request<void>("DELETE", `/api/rules/${id}`),
  reorderRules: (ids: number[]) => request<RulesResponse>("POST", "/api/rules/reorder", { ids }),
  previewRule: (body: RulePreviewRequest) => request<RulePreviewResponse>("POST", "/api/rules/preview", body),
};
