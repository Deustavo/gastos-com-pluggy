import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Hono } from "hono";
import { createApp } from "../src/api/app.ts";
import type {
  CategoriesResponse,
  ConnectionsResponse,
  OverrideResponse,
  SummaryResponse,
  TransactionsResponse,
} from "../src/api/contract.ts";
import { openDb, type Db } from "../src/db/index.ts";
import type { SyncReport } from "../src/sync/sync.ts";

// Dados 100% sintéticos, inseridos direto no banco (kind já definido)
const NOW = new Date("2026-10-20T12:00:00.000Z");
const BASE = "http://127.0.0.1:8787";
const FAKE_REPORT: SyncReport = {
  startedAt: NOW.toISOString(),
  finishedAt: NOW.toISOString(),
  windowFrom: NOW.toISOString(),
  connections: [],
  integrity: [],
  overrides: { matched: 0, orphaned: 0 },
  alerts: [],
};

interface Tx {
  fp: string;
  account: number;
  localDate: string;
  date?: string;
  abs: number;
  direction: "IN" | "OUT";
  kind: string;
  status?: "POSTED" | "PENDING";
  category?: string | null;
  installment?: [number, number];
}

const TXS: Tx[] = [
  { fp: "fp-a", account: 2, localDate: "2026-09-10", abs: 30_000, direction: "OUT", kind: "expense", category: "Shopping", installment: [2, 5] },
  { fp: "fp-b", account: 2, localDate: "2026-09-11", abs: 20_000, direction: "OUT", kind: "expense", category: "Groceries" },
  { fp: "fp-c", account: 2, localDate: "2026-09-12", abs: 5_000, direction: "IN", kind: "refund", category: "Shopping" },
  { fp: "fp-d", account: 2, localDate: "2026-09-13", abs: 50_000, direction: "IN", kind: "card_payment", category: "Transfers" },
  { fp: "fp-e", account: 1, localDate: "2026-09-13", abs: 50_000, direction: "OUT", kind: "card_payment", category: "Transfers" },
  { fp: "fp-f", account: 1, localDate: "2026-09-14", abs: 100_000, direction: "OUT", kind: "transfer", category: "Investments" },
  { fp: "fp-g", account: 1, localDate: "2026-09-15", abs: 4_000, direction: "OUT", kind: "expense", category: null },
  { fp: "fp-h", account: 1, localDate: "2026-09-16", abs: 9_999, direction: "OUT", kind: "expense", category: "Groceries" }, // ignorada
  { fp: "fp-i", account: 2, localDate: "2026-09-17", abs: 7_000, direction: "OUT", kind: "expense", category: "Shopping", status: "PENDING" },
  { fp: "fp-j", account: 1, localDate: "2026-09-05", abs: 900_000, direction: "IN", kind: "income", category: "Salary" },
  { fp: "fp-k", account: 1, localDate: "2026-09-06", abs: 1_000, direction: "IN", kind: "income", category: "Salary", status: "PENDING" },
  // UTC já em outubro, mas o dia local ainda é setembro
  { fp: "fp-l", account: 3, localDate: "2026-09-30", date: "2026-10-01T02:00:00.000Z", abs: 1_000, direction: "OUT", kind: "expense", category: "" },
  { fp: "fp-m", account: 1, localDate: "2026-03-03", abs: 1_234, direction: "OUT", kind: "expense", category: "Food" },
  { fp: "fp-n", account: 1, localDate: "2025-09-30", abs: 777, direction: "OUT", kind: "expense", category: "Food" }, // fora dos 12 meses
  { fp: "fp-o", account: 1, localDate: "2026-10-01", abs: 500, direction: "OUT", kind: "expense", category: "Food" }, // depois do mês
];

function seed(db: Db): void {
  db.exec(`
    INSERT INTO connections (id, provider, external_id, nickname, created_at) VALUES
      (1, 'fake', 'item-1', 'Banco X', '2026-01-01T00:00:00.000Z'),
      (2, 'fake', 'item-2', NULL, '2026-01-01T00:00:00.000Z');
    INSERT INTO accounts (id, connection_id, external_id, type, subtype, name, number_last4, currency, balance_cents) VALUES
      (1, 1, 'acc-1', 'BANK', 'CHECKING_ACCOUNT', 'Conta X', '1111', 'BRL', 12345),
      (2, 1, 'acc-2', 'CREDIT', 'CREDIT_CARD', 'Cartão Y', '2222', 'BRL', -500),
      (3, 1, 'acc-3', 'BANK', 'SAVINGS_ACCOUNT', 'Poupança Z', NULL, 'BRL', 0);
    INSERT INTO connection_status VALUES (1, 'UPDATED', '2026-10-19T10:00:00.000Z', '2026-11-19T12:00:00.000Z', '2026-10-20T11:00:00.000Z');
    INSERT INTO sync_runs (connection_id, started_at, finished_at, status, error, tx_count) VALUES
      (1, '2026-10-18T10:00:00.000Z', '2026-10-18T10:01:00.000Z', 'error', 'falha sintética', NULL),
      (1, '2026-10-20T10:00:00.000Z', '2026-10-20T10:01:00.000Z', 'success', NULL, 15);
    INSERT INTO overrides (fingerprint, category, ignored, note) VALUES ('fp-h', NULL, 1, NULL);
  `);
  const insert = db.prepare(`
    INSERT INTO transactions (account_id, fingerprint, date, local_date, description, amount_cents_raw, direction,
      amount_cents_abs, status, category, installment_number, total_installments, kind, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const t of TXS) {
    insert.run(
      t.account, t.fp, t.date ?? `${t.localDate}T15:00:00.000Z`, t.localDate, `Sintética ${t.fp}`,
      t.direction === "OUT" ? -t.abs : t.abs, t.direction, t.abs, t.status ?? "POSTED", t.category ?? null,
      t.installment?.[0] ?? null, t.installment?.[1] ?? null, t.kind, NOW.toISOString(),
    );
  }
}

let dir: string;
let db: Db;
let app: Hono;
let syncImpl: () => Promise<SyncReport> = async () => FAKE_REPORT;

const req = async (p: string, init?: RequestInit): Promise<Response> => app.request(`${BASE}${p}`, init);
const json = async <T>(p: string): Promise<T> => (await req(p)).json() as Promise<T>;
const patch = (fp: string, body: unknown, headers: Record<string, string> = {}) =>
  req(`/api/overrides/${fp}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const overrideRow = (fp: string) => db.prepare("SELECT category, ignored, note FROM overrides WHERE fingerprint = ?").get(fp);

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "openfinance-api-"));
  db = openDb(path.join(dir, "app.db"));
  seed(db);
  app = createApp({ db, runSync: () => syncImpl(), now: () => NOW, webDir: path.join(dir, "sem-web") });
});

after(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/summary", () => {
  test("totais: estorno abate; card_payment, transfer, ignored e pending fora", async () => {
    const s = await json<SummaryResponse>("/api/summary?month=2026-09");
    assert.equal(s.month, "2026-09");
    assert.equal(s.expenseCents, 30_000 + 20_000 - 5_000 + 4_000 + 1_000);
    assert.equal(s.incomeCents, 900_000);
    assert.equal(s.pendingExpenseCents, 7_000);
    assert.equal(s.pendingCount, 1);
    assert.deepEqual(s.byCategory, [
      { category: "Shopping", expenseCents: 25_000 },
      { category: "Groceries", expenseCents: 20_000 },
      { category: "Sem categoria", expenseCents: 5_000 },
    ]);
  });

  test("12 meses até `month`, em ordem, com zeros", async () => {
    const s = await json<SummaryResponse>("/api/summary?month=2026-09");
    assert.equal(s.monthly.length, 12);
    assert.equal(s.monthly[0]?.month, "2025-10");
    assert.equal(s.monthly[11]?.month, "2026-09");
    const nonZero = s.monthly.filter((m) => m.expenseCents || m.incomeCents);
    assert.deepEqual(nonZero, [
      { month: "2026-03", expenseCents: 1_234, incomeCents: 0 },
      { month: "2026-09", expenseCents: 50_000, incomeCents: 900_000 },
    ]);
  });

  test("mês padrão é o atual e mês vazio dá zeros", async () => {
    const s = await json<SummaryResponse>("/api/summary");
    assert.equal(s.month, "2026-10");
    assert.equal(s.expenseCents, 500);
    const empty = await json<SummaryResponse>("/api/summary?month=2020-01");
    assert.deepEqual([empty.expenseCents, empty.incomeCents, empty.byCategory.length], [0, 0, 0]);
  });

  test("month inválido → 400", async () => {
    for (const m of ["2026-13", "2026-9", "abc", ""]) {
      const r = await req(`/api/summary?month=${m}`);
      assert.equal(r.status, 400, m);
      assert.ok(((await r.json()) as { error: string }).error);
    }
  });
});

describe("GET /api/transactions", () => {
  const fps = (r: TransactionsResponse): string[] => r.items.map((i) => i.fingerprint);

  test("lista do mês em local_date desc, com sinal, rótulo e parcelas", async () => {
    const r = await json<TransactionsResponse>("/api/transactions?month=2026-09");
    assert.equal(r.items.length, 12);
    assert.equal(r.items[0]?.fingerprint, "fp-l"); // dia local 30/09
    const dates = r.items.map((i) => i.localDate);
    assert.deepEqual(dates, [...dates].sort().reverse());

    const by = new Map(r.items.map((i) => [i.fingerprint, i]));
    assert.equal(by.get("fp-a")?.amountCents, -30_000);
    assert.equal(by.get("fp-c")?.amountCents, 5_000);
    assert.equal(by.get("fp-j")?.amountCents, 900_000);
    assert.equal(by.get("fp-a")?.accountLabel, "Cartão ••••2222");
    assert.equal(by.get("fp-e")?.accountLabel, "Conta ••••1111");
    assert.equal(by.get("fp-l")?.accountLabel, "Poupança Z");
    assert.deepEqual(by.get("fp-a")?.installment, { number: 2, total: 5 });
    assert.equal(by.get("fp-b")?.installment, null);
    assert.equal(by.get("fp-g")?.category, "Sem categoria");
    assert.equal(by.get("fp-g")?.providerCategory, null);
    assert.deepEqual(
      [by.get("fp-h")?.ignored, by.get("fp-h")?.overridden, by.get("fp-h")?.category],
      [true, false, "Groceries"],
    );
  });

  test("filtros", async () => {
    assert.deepEqual(fps(await json<TransactionsResponse>("/api/transactions?month=2026-09&category=Sem%20categoria")).sort(), ["fp-g", "fp-l"]);
    assert.deepEqual(fps(await json<TransactionsResponse>("/api/transactions?month=2026-09&account=2")).sort(), ["fp-a", "fp-b", "fp-c", "fp-d", "fp-i"]);
    assert.deepEqual(fps(await json<TransactionsResponse>("/api/transactions?month=2026-09&status=PENDING")).sort(), ["fp-i", "fp-k"]);
    assert.deepEqual(fps(await json<TransactionsResponse>("/api/transactions?month=2026-09&kind=refund")), ["fp-c"]);
    assert.deepEqual(fps(await json<TransactionsResponse>("/api/transactions?month=2026-09&account=2&kind=expense&status=POSTED")).sort(), ["fp-a", "fp-b"]);
  });

  test("validação → 400", async () => {
    for (const q of ["", "?month=2026-9", "?month=2026-09&account=abc", "?month=2026-09&status=X", "?month=2026-09&kind=foo"]) {
      assert.equal((await req(`/api/transactions${q}`)).status, 400, q);
    }
  });
});

test("GET /api/categories: distintas, ordenadas, com 'Sem categoria'", async () => {
  const r = await json<CategoriesResponse>("/api/categories");
  assert.deepEqual(r.categories, ["Food", "Groceries", "Investments", "Salary", "Sem categoria", "Shopping", "Transfers"]);
});

test("GET /api/connections: consentimento, último run e contas", async () => {
  const r = await json<ConnectionsResponse>("/api/connections");
  assert.equal(r.connections.length, 2);
  const [c1, c2] = r.connections;
  assert.equal(c1?.providerStatus, "UPDATED");
  assert.equal(c1?.lastUpdatedAt, "2026-10-19T10:00:00.000Z");
  assert.equal(c1?.consentExpiresAt, "2026-11-19T12:00:00.000Z");
  assert.equal(c1?.daysToConsentExpiry, 30);
  assert.equal(c1?.nickname, "Banco X");
  assert.deepEqual(c1?.lastRun, { status: "success", startedAt: "2026-10-20T10:00:00.000Z", finishedAt: "2026-10-20T10:01:00.000Z", error: null });
  assert.deepEqual(c1?.accounts[1], { id: 2, type: "CREDIT", subtype: "CREDIT_CARD", name: "Cartão Y", numberLast4: "2222", balanceCents: -500 });
  assert.equal(c1?.accounts.length, 3);
  // conexão nunca sincronizada
  assert.deepEqual(
    [c2?.providerStatus, c2?.consentExpiresAt, c2?.daysToConsentExpiry, c2?.lastRun, c2?.accounts],
    [null, null, null, null, []],
  );
});

describe("PATCH /api/overrides/:fingerprint", () => {
  test("cria, edita parcialmente e reseta apagando a linha", async () => {
    let r = await patch("fp-b", { category: "  Mercado  " });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { fingerprint: "fp-b", category: "Mercado", ignored: false, note: null } satisfies OverrideResponse);

    r = await patch("fp-b", { note: "nota sintética" });
    assert.deepEqual(await r.json(), { fingerprint: "fp-b", category: "Mercado", ignored: false, note: "nota sintética" });

    const tx = (await json<TransactionsResponse>("/api/transactions?month=2026-09&category=Mercado")).items[0];
    assert.deepEqual([tx?.fingerprint, tx?.overridden, tx?.providerCategory, tx?.note], ["fp-b", true, "Groceries", "nota sintética"]);

    r = await patch("fp-b", { ignored: true });
    assert.deepEqual(overrideRow("fp-b"), { category: "Mercado", ignored: 1, note: "nota sintética" });
    assert.equal((await json<SummaryResponse>("/api/summary?month=2026-09")).expenseCents, 30_000);

    r = await patch("fp-b", { category: null, ignored: false, note: null });
    assert.deepEqual(await r.json(), { fingerprint: "fp-b", category: null, ignored: false, note: null });
    assert.equal(overrideRow("fp-b"), undefined);
    assert.equal((await json<SummaryResponse>("/api/summary?month=2026-09")).expenseCents, 50_000);

    // override existente (fp-h ignorada): desfazer o ignored apaga a linha
    r = await patch("fp-h", { ignored: false });
    assert.equal(r.status, 200);
    assert.equal(overrideRow("fp-h"), undefined);
    await patch("fp-h", { ignored: true });
  });

  test("404 para fingerprint inexistente", async () => {
    assert.equal((await patch("nao-existe", { ignored: true })).status, 404);
  });

  test("validação → 400", async () => {
    const bad: unknown[] = [
      { category: "" },
      { category: "   " },
      { category: "x".repeat(61) },
      { category: 1 },
      { ignored: "yes" },
      { note: "x".repeat(501) },
      { note: 3 },
      { outro: 1 },
      [],
      "{invalido",
    ];
    for (const b of bad) assert.equal((await patch("fp-a", b)).status, 400, JSON.stringify(b));
    assert.equal(overrideRow("fp-a"), undefined);
  });
});

describe("segurança", () => {
  test("Host fora de localhost → 403; localhost em outra porta passa", async () => {
    assert.equal((await req("/api/categories", { headers: { Host: "evil.com" } })).status, 403);
    assert.equal((await req("/api/categories", { headers: { Host: "evil.com:8787" } })).status, 403);
    assert.equal((await req("/api/categories", { headers: { Host: "127.0.0.1.evil.com:8787" } })).status, 403);
    assert.equal((await req("/api/categories", { headers: { Host: "localhost:5173" } })).status, 200);
  });

  test("Origin de outro site → 403; Origin local passa", async () => {
    assert.equal((await patch("fp-a", { note: "x" }, { Origin: "https://evil.com" })).status, 403);
    assert.equal((await patch("fp-a", { note: "x" }, { Origin: "http://localhost.evil.com:80" })).status, 403);
    assert.equal(overrideRow("fp-a"), undefined);
    assert.equal((await patch("fp-a", { note: null }, { Origin: "http://localhost:5173" })).status, 200);
  });

  test("PATCH/POST sem JSON → 415", async () => {
    const r = await req("/api/overrides/fp-a", { method: "PATCH", headers: { "Content-Type": "text/plain" }, body: "{}" });
    assert.equal(r.status, 415);
    assert.equal((await req("/api/sync", { method: "POST" })).status, 415);
  });

  test("rota /api desconhecida → 404 JSON; sem web/dist, GET / explica o build", async () => {
    const r = await req("/api/nada");
    assert.equal(r.status, 404);
    assert.ok(((await r.json()) as { error: string }).error);
    assert.match(await (await req("/")).text(), /npm run web:build/);
  });
});

describe("POST /api/sync", () => {
  const post = () => req("/api/sync", { method: "POST", headers: { "Content-Type": "application/json" } });

  test("409 enquanto outro sync roda; libera depois", async () => {
    let release!: () => void;
    syncImpl = () => new Promise((resolve) => (release = () => resolve(FAKE_REPORT)));
    const first = post();
    await new Promise((r) => setImmediate(r));
    const second = await post();
    assert.equal(second.status, 409);
    release();
    const r1 = await first;
    assert.equal(r1.status, 200);
    assert.deepEqual(await r1.json(), FAKE_REPORT);

    syncImpl = async () => FAKE_REPORT;
    assert.equal((await post()).status, 200);
  });

  test("erro no sync → 500 genérico e mutex liberado", async (t) => {
    const logged: unknown[] = [];
    t.mock.method(console, "error", (...args: unknown[]) => logged.push(args));
    syncImpl = async () => {
      throw new Error("detalhe sintético");
    };
    const r = await post();
    assert.equal(r.status, 500);
    assert.deepEqual(await r.json(), { error: "erro interno" });
    assert.equal(logged.length, 1);
    syncImpl = async () => FAKE_REPORT;
    assert.equal((await post()).status, 200);
  });
});

test("serve web/dist com fallback para index.html", async () => {
  const web = path.join(dir, "web");
  fs.mkdirSync(path.join(web, "assets"), { recursive: true });
  fs.writeFileSync(path.join(web, "index.html"), "<!doctype html><title>SPA</title>");
  fs.writeFileSync(path.join(web, "assets", "app.js"), "console.log(1)");
  const spa = createApp({ db, runSync: async () => FAKE_REPORT, webDir: web });
  const get = (p: string) => spa.request(`${BASE}${p}`);
  assert.match(await (await get("/")).text(), /SPA/);
  assert.match(await (await get("/transacoes/123")).text(), /SPA/);
  assert.equal(await (await get("/assets/app.js")).text(), "console.log(1)");
  assert.equal((await get("/api/nada")).status, 404);
  assert.equal((await get("/")).status, 200);
  assert.equal((await spa.request(`${BASE}/`, { headers: { Host: "evil.com" } })).status, 403);
});
