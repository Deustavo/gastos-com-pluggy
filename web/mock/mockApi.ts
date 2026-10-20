// MOCK DE DESENVOLVIMENTO — dados 100% sintéticos, só para testar o front sem a API real.
// Desligado por padrão: o vite.config só carrega este arquivo com WEB_MOCK=1.
// Não faz parte do build (web/dist) nem da API de produção.

import type { Plugin } from "vite";
import type {
  ConnectionsResponse,
  OverrideRequest,
  SummaryResponse,
  SyncReport,
  TransactionRow,
} from "../../src/api/contract.ts";

const CATS = ["Mercado", "Restaurantes", "Transporte", "Moradia", "Lazer", "Saúde"];
const overrides = new Map<string, { category?: string | null; ignored?: boolean }>();
let syncing = false;

function rowsFor(month: string): TransactionRow[] {
  const seed = Number(month.replace("-", ""));
  const rows: TransactionRow[] = [];
  for (let i = 0; i < 24; i++) {
    const day = String(28 - i).padStart(2, "0");
    const kindIdx = (seed + i) % 9;
    const kind = kindIdx === 0 ? "income" : kindIdx === 1 ? "transfer" : kindIdx === 2 ? "card_payment" : kindIdx === 3 ? "refund" : "expense";
    const out = kind === "expense" || kind === "transfer" || kind === "card_payment";
    const abs = ((seed * (i + 7)) % 40000) + 1500;
    const fp = `fp-${month}-${i}`;
    const providerCategory = i % 7 === 0 ? null : CATS[(seed + i) % CATS.length]!;
    const ov = overrides.get(fp);
    const cat = ov?.category ?? providerCategory ?? "Sem categoria";
    rows.push({
      id: seed * 100 + i,
      fingerprint: fp,
      accountId: i % 3 === 0 ? 2 : 1,
      accountLabel: i % 3 === 0 ? "Conta ••••0001" : "Cartão ••••1234",
      localDate: `${month}-${day}`,
      description: `Transação sintética ${i + 1}`,
      amountCents: out ? -abs : abs,
      kind,
      status: i < 3 ? "PENDING" : "POSTED",
      category: cat,
      providerCategory,
      overridden: ov?.category != null,
      ignored: ov?.ignored ?? false,
      note: null,
      installment: i % 5 === 0 ? { number: (i % 4) + 1, total: 10 } : null,
    });
  }
  return rows;
}

function addMonths(m: string, d: number): string {
  const [y, mm] = m.split("-").map(Number) as [number, number];
  const idx = y * 12 + mm - 1 + d;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

function totals(month: string) {
  const rows = rowsFor(month).filter((r) => !r.ignored && r.status === "POSTED");
  const byCat = new Map<string, number>();
  let expense = 0;
  let income = 0;
  for (const r of rows) {
    if (r.kind === "expense" || r.kind === "refund") {
      expense -= r.amountCents;
      byCat.set(r.category, (byCat.get(r.category) ?? 0) - r.amountCents);
    }
    if (r.kind === "income") income += r.amountCents;
  }
  return { expense, income, byCat };
}

function summary(month: string): SummaryResponse {
  const t = totals(month);
  const pend = rowsFor(month).filter((r) => r.status === "PENDING" && r.kind === "expense" && !r.ignored);
  return {
    month,
    expenseCents: t.expense,
    incomeCents: t.income,
    pendingExpenseCents: pend.reduce((n, r) => n - r.amountCents, 0),
    pendingCount: pend.length,
    byCategory: [...t.byCat.entries()].map(([category, expenseCents]) => ({ category, expenseCents })).sort((a, b) => b.expenseCents - a.expenseCents),
    monthly: Array.from({ length: 12 }, (_, i) => {
      const m = addMonths(month, i - 11);
      const tt = totals(m);
      return { month: m, expenseCents: tt.expense, incomeCents: tt.income };
    }),
  };
}

const connections: ConnectionsResponse = {
  connections: [
    {
      id: 1, provider: "pluggy", nickname: "Banco sintético", providerStatus: "UPDATED",
      lastUpdatedAt: new Date().toISOString(), consentExpiresAt: new Date(Date.now() + 20 * 864e5).toISOString(),
      daysToConsentExpiry: 20,
      lastRun: { status: "success", startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), error: null },
      accounts: [
        { id: 1, type: "CREDIT", subtype: "CREDIT_CARD", name: "Cartão", numberLast4: "1234", balanceCents: -123456 },
        { id: 2, type: "BANK", subtype: "CHECKING_ACCOUNT", name: "Corrente", numberLast4: "0001", balanceCents: 987654 },
      ],
    },
    {
      id: 2, provider: "pluggy", nickname: null, providerStatus: "LOGIN_ERROR", lastUpdatedAt: null,
      consentExpiresAt: new Date(Date.now() - 3 * 864e5).toISOString(), daysToConsentExpiry: -3,
      lastRun: { status: "error", startedAt: new Date().toISOString(), finishedAt: null, error: "consentimento expirado" },
      accounts: [],
    },
  ],
};

export function mockApi(): Plugin {
  return {
    name: "openfinance-mock-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/")) return next();
        const url = new URL(req.url, "http://x");
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(body));
        };
        const readBody = async () => {
          let s = "";
          for await (const c of req) s += c;
          return s ? JSON.parse(s) : {};
        };
        const month = url.searchParams.get("month") ?? "2026-10";
        if (url.pathname === "/api/summary") return send(200, summary(month));
        if (url.pathname === "/api/transactions") return send(200, { items: rowsFor(month) });
        if (url.pathname === "/api/categories") {
          const extra = [...overrides.values()].map((o) => o.category).filter((c): c is string => !!c);
          return send(200, { categories: [...new Set([...CATS, "Sem categoria", ...extra])].sort() });
        }
        if (url.pathname === "/api/connections") return send(200, connections);
        if (url.pathname.startsWith("/api/overrides/") && req.method === "PATCH") {
          const fp = decodeURIComponent(url.pathname.slice("/api/overrides/".length));
          const body = (await readBody()) as OverrideRequest;
          const cur = overrides.get(fp) ?? {};
          if ("category" in body) cur.category = body.category ?? null;
          if ("ignored" in body) cur.ignored = body.ignored;
          overrides.set(fp, cur);
          return send(200, { fingerprint: fp, category: cur.category ?? null, ignored: cur.ignored ?? false, note: null });
        }
        if (url.pathname === "/api/sync" && req.method === "POST") {
          if (syncing) return send(409, { error: "sync em andamento" });
          syncing = true;
          await new Promise((r) => setTimeout(r, 1500));
          syncing = false;
          const report: SyncReport = {
            startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), windowFrom: "2025-10-20",
            connections: [
              { connectionId: 1, provider: "pluggy", status: "success", txCount: 42, accounts: [] },
              { connectionId: 2, provider: "pluggy", status: "error", error: "consentimento expirado", txCount: 0, accounts: [] },
            ],
            integrity: [{ accountId: 1, ok: 5, mismatch: 1, outOfWindow: 0, mismatches: [{ billId: "b1", diffCents: 120 }] }],
            overrides: { matched: overrides.size, orphaned: 0 },
            alerts: ["Consentimento da conexão 1 expira em 20 dias"],
          };
          return send(200, report);
        }
        return send(404, { error: "rota não encontrada (mock)" });
      });
    },
  };
}
