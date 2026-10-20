// MOCK DE DESENVOLVIMENTO — dados 100% sintéticos, só para testar o front sem a API real.
// Desligado por padrão: o vite.config só carrega este arquivo com WEB_MOCK=1.
// Não faz parte do build (web/dist) nem da API de produção.

import type { Plugin } from "vite";
import type {
  CategoryRule,
  CategorySource,
  ConnectionsResponse,
  OverrideRequest,
  RuleCreateRequest,
  RulePreviewRequest,
  RulePreviewResponse,
  RuleReorderRequest,
  RuleUpdateRequest,
  SummaryResponse,
  SyncReport,
  TransactionRow,
} from "../../src/api/contract.ts";

const CATS = ["Mercado", "Restaurantes", "Transporte", "Moradia", "Lazer", "Saúde"];
const overrides = new Map<string, { category?: string | null; ignored?: boolean }>();
let syncing = false;

// Descrições sintéticas no estilo de extrato/fatura, com a categoria "do fornecedor".
const MERCHANTS: { description: string; category: string | null }[] = [
  { description: "UBER *TRIP 0423", category: "Transporte" },
  { description: "IFD*RESTAURANTE SABOR CASEIRO", category: "Restaurantes" },
  { description: "SUPERMERCADO BOM PREÇO 12/10", category: "Mercado" },
  { description: "PAG*PadariaPaoQuente", category: null },
  { description: "99APP *99RIDE", category: "Transporte" },
  { description: "NETFLIX.COM", category: "Lazer" },
  { description: "FARMÁCIA SÃO JOÃO 0042", category: "Saúde" },
  { description: "POSTO SHELL 123456", category: "Transporte" },
  { description: "PIX ENVIADO JOAO SILVA", category: null },
  { description: "CONDOMINIO RES JARDIM", category: "Moradia" },
  { description: "SPOTIFY", category: "Lazer" },
  { description: "MP *LOJA DO BAIRRO", category: "Mercado" },
];

// Regras de categorização em memória (mesma semântica do contrato).
let rules: Omit<CategoryRule, "matchCount">[] = [
  { id: 1, pattern: "UBER|99APP", category: "Transporte por app", priority: 0, enabled: true, createdAt: "2026-10-01T12:00:00Z" },
  { id: 2, pattern: "PADARIA", category: "Padaria", priority: 1, enabled: true, createdAt: "2026-10-02T12:00:00Z" },
  { id: 3, pattern: "NETFLIX|SPOTIFY", category: "Assinaturas", priority: 2, enabled: false, createdAt: "2026-10-03T12:00:00Z" },
];
let nextRuleId = 4;

const deaccent = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
function compile(pattern: string): RegExp {
  return new RegExp(deaccent(pattern), "i");
}
function ordered() {
  return [...rules].sort((a, b) => a.priority - b.priority || a.id - b.id);
}
function matchRule(description: string, excludeId?: number) {
  const d = deaccent(description);
  return ordered().find((r) => r.enabled && r.id !== excludeId && compile(r.pattern).test(d));
}

function rowsFor(month: string, excludeRuleId?: number): TransactionRow[] {
  const seed = Number(month.replace("-", ""));
  const rows: TransactionRow[] = [];
  for (let i = 0; i < 24; i++) {
    const day = String(28 - i).padStart(2, "0");
    const kindIdx = (seed + i) % 9;
    const kind = kindIdx === 0 ? "income" : kindIdx === 1 ? "transfer" : kindIdx === 2 ? "card_payment" : kindIdx === 3 ? "refund" : "expense";
    const out = kind === "expense" || kind === "transfer" || kind === "card_payment";
    const abs = ((seed * (i + 7)) % 40000) + 1500;
    const fp = `fp-${month}-${i}`;
    const merchant = MERCHANTS[(seed + i * 5) % MERCHANTS.length]!;
    const providerCategory = merchant.category;
    const ov = overrides.get(fp);
    const rule = matchRule(merchant.description, excludeRuleId);
    const cat = ov?.category ?? rule?.category ?? providerCategory ?? "Sem categoria";
    const categorySource: CategorySource =
      ov?.category != null ? "override" : rule ? "rule" : providerCategory ? "provider" : "none";
    rows.push({
      id: seed * 100 + i,
      fingerprint: fp,
      accountId: i % 3 === 0 ? 2 : 1,
      accountLabel: i % 3 === 0 ? "Conta ••••0001" : "Cartão ••••1234",
      localDate: `${month}-${day}`,
      description: merchant.description,
      amountCents: out ? -abs : abs,
      kind,
      status: i < 3 ? "PENDING" : "POSTED",
      category: cat,
      categorySource,
      ruleId: rule?.id ?? null,
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

// "Banco inteiro" do mock: 12 meses até out/26, mais recentes primeiro.
function allRows(excludeRuleId?: number): TransactionRow[] {
  return Array.from({ length: 12 }, (_, i) => rowsFor(addMonths("2026-10", -i), excludeRuleId)).flat();
}

function rulesResponse(): { rules: CategoryRule[] } {
  const counts = new Map<number, number>();
  for (const r of allRows()) if (r.ruleId !== null && r.categorySource === "rule") counts.set(r.ruleId, (counts.get(r.ruleId) ?? 0) + 1);
  return { rules: ordered().map((r) => ({ ...r, matchCount: counts.get(r.id) ?? 0 })) };
}

// Mesmas validações do contrato; devolve a mensagem de erro (400) ou undefined.
function validate(body: Partial<RuleCreateRequest>, partial: boolean): string | undefined {
  if (!partial || body.pattern !== undefined) {
    const p = typeof body.pattern === "string" ? body.pattern.trim() : "";
    if (!p) return "Padrão vazio";
    if (p.length > 200) return "Padrão com mais de 200 caracteres";
    try {
      compile(p);
    } catch (e) {
      return `Regex inválida: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  if (!partial || body.category !== undefined) {
    const c = typeof body.category === "string" ? body.category.trim() : "";
    if (!c) return "Categoria vazia";
    if (c.length > 60) return "Categoria com mais de 60 caracteres";
  }
  return undefined;
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
          const fromRules = rules.filter((r) => r.enabled).map((r) => r.category);
          return send(200, { categories: [...new Set([...CATS, "Sem categoria", ...extra, ...fromRules])].sort((a, b) => a.localeCompare(b, "pt-BR")) });
        }
        if (url.pathname === "/api/rules" && req.method === "GET") return send(200, rulesResponse());
        if (url.pathname === "/api/rules" && req.method === "POST") {
          const body = (await readBody()) as RuleCreateRequest;
          const err = validate(body, false);
          if (err) return send(400, { error: err });
          const max = Math.max(-1, ...rules.map((r) => r.priority));
          const rule = {
            id: nextRuleId++, pattern: body.pattern.trim(), category: body.category.trim(),
            priority: body.priority ?? max + 1, enabled: body.enabled ?? true, createdAt: new Date().toISOString(),
          };
          rules.push(rule);
          return send(201, rulesResponse().rules.find((r) => r.id === rule.id));
        }
        if (url.pathname === "/api/rules/reorder" && req.method === "POST") {
          const { ids } = (await readBody()) as RuleReorderRequest;
          if (!Array.isArray(ids) || ids.length !== rules.length || new Set(ids).size !== ids.length || !rules.every((r) => ids.includes(r.id)))
            return send(400, { error: "ids deve conter todas as regras" });
          rules = rules.map((r) => ({ ...r, priority: ids.indexOf(r.id) }));
          return send(200, rulesResponse());
        }
        if (url.pathname === "/api/rules/preview" && req.method === "POST") {
          const body = (await readBody()) as RulePreviewRequest;
          const err = validate({ pattern: body.pattern }, true);
          if (err) return send(400, { error: err });
          await new Promise((r) => setTimeout(r, 120)); // latência fictícia
          const re = compile(body.pattern.trim());
          const hits = allRows(body.excludeRuleId)
            .filter((r) => re.test(deaccent(r.description)))
            .sort((a, b) => b.localDate.localeCompare(a.localDate));
          const resp: RulePreviewResponse = {
            matchCount: hits.length,
            sample: hits.slice(0, 20).map((r) => ({
              localDate: r.localDate, description: r.description, amountCents: r.amountCents, currentCategory: r.category,
            })),
          };
          return send(200, resp);
        }
        const ruleMatch = /^\/api\/rules\/(\d+)$/.exec(url.pathname);
        if (ruleMatch) {
          const id = Number(ruleMatch[1]);
          const rule = rules.find((r) => r.id === id);
          if (!rule) return send(404, { error: "regra não encontrada" });
          if (req.method === "DELETE") {
            rules = rules.filter((r) => r.id !== id);
            res.statusCode = 204;
            return res.end();
          }
          if (req.method === "PATCH") {
            const body = (await readBody()) as RuleUpdateRequest;
            const err = validate(body, true);
            if (err) return send(400, { error: err });
            if (body.pattern !== undefined) rule.pattern = body.pattern.trim();
            if (body.category !== undefined) rule.category = body.category.trim();
            if (body.priority !== undefined) rule.priority = body.priority;
            if (body.enabled !== undefined) rule.enabled = body.enabled;
            return send(200, rulesResponse().rules.find((r) => r.id === id));
          }
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
