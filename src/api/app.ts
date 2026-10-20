// API local (Hono) do dashboard. Só escuta em 127.0.0.1 (ver scripts/server.ts);
// mesmo assim valida Host e Origin, porque um site aberto no navegador alcança localhost.

import fs from "node:fs";
import path from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import type { Db } from "../db/index.ts";
import type { Kind } from "../sync/classify.ts";
import { toLocalDate } from "../sync/dates.ts";
import type { SyncReport } from "../sync/sync.ts";
import { canonicalCategory, parseCategory } from "../categorize/categories.ts";
import { applyNature, NATURES } from "../categorize/nature.ts";
import { applyRules, compileRule } from "../categorize/rules.ts";
import type { ApiError, Nature, OverrideRequest, OverrideResponse, RuleCreateRequest } from "./contract.ts";
import {
  deleteRule,
  fingerprintExists,
  getOverride,
  getRule,
  getSummary,
  insertRule,
  listCategories,
  listConnections,
  listRules,
  listTransactions,
  natureTarget,
  previewRule,
  reorderRules,
  ruleIds,
  saveNatureMark,
  saveOverride,
  updateRule,
} from "./queries.ts";

export interface AppDeps {
  db: Db;
  runSync: () => Promise<SyncReport>;
  now?: () => Date; // injetável nos testes
  webDir?: string; // padrão: web/dist na raiz do projeto
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const LOCAL_HOST_RE = /^(127\.0\.0\.1|localhost):\d{1,5}$/;
const LOCAL_ORIGIN_RE = /^http:\/\/(127\.0\.0\.1|localhost):\d{1,5}$/;
const STATUSES = ["POSTED", "PENDING"] as const;
const KINDS: readonly Kind[] = ["expense", "income", "transfer", "card_payment", "refund"];
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const DEFAULT_WEB_DIR = path.resolve(import.meta.dirname, "../../web/dist");

// Erro de validação: vira 400 com ApiError
class BadRequest extends Error {}

const fail = (c: Context, status: 400 | 403 | 404 | 409 | 415 | 500, error: string) =>
  c.json<ApiError>({ error }, status);

function parseMonth(value: string | undefined): string {
  if (value === undefined || !MONTH_RE.test(value)) throw new BadRequest("month deve estar no formato YYYY-MM");
  return value;
}

function parseEnum<T extends string>(name: string, value: string | undefined, allowed: readonly T[]): T | undefined {
  if (value === undefined || value === "") return undefined;
  if (!(allowed as readonly string[]).includes(value)) throw new BadRequest(`${name} deve ser um de: ${allowed.join(", ")}`);
  return value as T;
}

async function readJson(c: Context): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new BadRequest("JSON inválido");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new BadRequest("corpo deve ser um objeto JSON");
  return body as Record<string, unknown>;
}

function rejectExtra(req: Record<string, unknown>, allowed: string[]): void {
  const extra = Object.keys(req).filter((k) => !allowed.includes(k));
  if (extra.length) throw new BadRequest(`campos desconhecidos: ${extra.join(", ")}`);
}

function parseId(value: string): number {
  if (!/^\d{1,9}$/.test(value)) throw new BadRequest("id deve ser numérico");
  return Number(value);
}

function parsePattern(v: unknown): string {
  if (typeof v !== "string") throw new BadRequest("pattern deve ser texto");
  const pattern = v.trim();
  try {
    compileRule(pattern);
  } catch (e) {
    throw new BadRequest((e as Error).message);
  }
  return pattern;
}

// Categoria de override ou regra: valida e reaproveita a grafia de uma já existente
function parseCategoryFor(db: Db, v: unknown): string {
  let name: string;
  try {
    name = parseCategory(v);
  } catch (e) {
    throw new BadRequest((e as Error).message);
  }
  return canonicalCategory(name, listCategories(db).categories);
}

// Aplica POST/PATCH de regra sobre o estado atual (no POST, `current` tem só os padrões).
type RuleDraft = Omit<RuleCreateRequest, "pattern" | "category"> & { pattern?: string; category?: string; enabled: boolean };
function mergeRule<T extends RuleDraft>(db: Db, current: T, req: Record<string, unknown>): T {
  rejectExtra(req, ["pattern", "category", "priority", "enabled"]);
  const next = { ...current };
  if ("pattern" in req) next.pattern = parsePattern(req.pattern);
  if ("category" in req) next.category = parseCategoryFor(db, req.category);
  if ("priority" in req) {
    const v = req.priority;
    if (typeof v !== "number" || !Number.isSafeInteger(v)) throw new BadRequest("priority deve ser inteiro");
    next.priority = v;
  }
  if ("enabled" in req) {
    if (typeof req.enabled !== "boolean") throw new BadRequest("enabled deve ser boolean");
    next.enabled = req.enabled;
  }
  return next;
}

// Aplica o PATCH sobre o override atual; campos ausentes ficam como estão.
function mergeOverride(db: Db, current: OverrideResponse, req: Record<string, unknown>): OverrideResponse {
  rejectExtra(req, ["category", "ignored", "note"]);
  const next = { ...current };

  if ("category" in req) {
    const v = req.category as OverrideRequest["category"];
    if (v === null) next.category = null;
    else if (typeof v === "string") next.category = parseCategoryFor(db, v);
    else throw new BadRequest("category deve ser texto não vazio de até 60 caracteres, ou null");
  }
  if ("ignored" in req) {
    if (typeof req.ignored !== "boolean") throw new BadRequest("ignored deve ser boolean");
    next.ignored = req.ignored;
  }
  if ("note" in req) {
    const v = req.note;
    if (v === null) next.note = null;
    else if (typeof v === "string" && v.length <= 500) next.note = v.trim() || null;
    else throw new BadRequest("note deve ser texto de até 500 caracteres, ou null");
  }
  return next;
}

export function createApp({ db, runSync, now = () => new Date(), webDir = DEFAULT_WEB_DIR }: AppDeps): Hono {
  const app = new Hono();
  let syncing = false;

  // DNS rebinding: só aceita Host local (qualquer porta, por causa do proxy do Vite)
  app.use("*", async (c, next) => {
    const host = c.req.header("host") ?? new URL(c.req.url).host;
    if (!LOCAL_HOST_RE.test(host)) return fail(c, 403, "host não permitido");
    await next();
  });

  // CSRF: métodos que alteram estado exigem, se houver Origin, que seja local, e JSON
  // (DELETE não tem corpo, então não exige Content-Type; de outro site já cai no preflight do CORS)
  app.use("*", async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next();
    const origin = c.req.header("origin");
    if (origin !== undefined && !LOCAL_ORIGIN_RE.test(origin)) return fail(c, 403, "origem não permitida");
    if (c.req.method === "DELETE") return next();
    const type = c.req.header("content-type") ?? "";
    if (!/^application\/json\s*(;|$)/i.test(type)) return fail(c, 415, "Content-Type deve ser application/json");
    await next();
  });

  app.onError((err, c) => {
    if (err instanceof BadRequest) return fail(c, 400, err.message);
    console.error(`erro na API: ${err.message}`);
    return fail(c, 500, "erro interno");
  });

  app.get("/api/summary", (c) => {
    const q = c.req.query("month");
    const month = q === undefined ? toLocalDate(now().toISOString()).slice(0, 7) : parseMonth(q);
    return c.json(getSummary(db, month));
  });

  app.get("/api/transactions", (c) => {
    const account = c.req.query("account");
    if (account !== undefined && account !== "" && !/^\d+$/.test(account)) throw new BadRequest("account deve ser numérico");
    const category = c.req.query("category");
    return c.json(
      listTransactions(db, {
        month: parseMonth(c.req.query("month")),
        category: category || undefined,
        account: account ? Number(account) : undefined,
        status: parseEnum("status", c.req.query("status"), STATUSES),
        kind: parseEnum("kind", c.req.query("kind"), KINDS),
      }),
    );
  });

  app.get("/api/categories", (c) => c.json(listCategories(db)));

  app.get("/api/connections", (c) => c.json(listConnections(db, now())));

  app.patch("/api/overrides/:fingerprint", async (c) => {
    const fp = c.req.param("fingerprint");
    if (!fingerprintExists(db, fp)) return fail(c, 404, "transação não encontrada");
    const current = getOverride(db, fp);
    const next = mergeOverride(db, current, await readJson(c));
    saveOverride(db, next);
    if (next.ignored !== current.ignored) applyNature(db); // a detecção desconsidera as ignoradas
    return c.json(next);
  });

  app.patch("/api/natures/:fingerprint", async (c) => {
    const target = natureTarget(db, c.req.param("fingerprint"));
    if (!target) return fail(c, 404, "transação não encontrada");
    const req = await readJson(c);
    rejectExtra(req, ["nature"]);
    const nature = req.nature;
    if (nature !== null && !NATURES.includes(nature as Nature)) {
      throw new BadRequest(`nature deve ser um de: ${NATURES.join(", ")}, ou null`);
    }
    if (target.key === null) throw new BadRequest("só gastos e estornos com descrição podem ser marcados como fixo ou variável");
    return c.json(saveNatureMark(db, target.key, nature as Nature | null, now()));
  });

  // Regras: toda mudança recalcula rule_id/rule_category de todas as transações
  app.get("/api/rules", (c) => c.json(listRules(db)));

  app.post("/api/rules", async (c) => {
    const draft = mergeRule<RuleDraft>(db, { enabled: true }, await readJson(c));
    if (draft.pattern === undefined) throw new BadRequest("pattern é obrigatório");
    if (draft.category === undefined) throw new BadRequest("category é obrigatório");
    const id = insertRule(db, { ...draft, pattern: draft.pattern, category: draft.category }, now());
    applyRules(db);
    return c.json(getRule(db, id), 201);
  });

  app.post("/api/rules/reorder", async (c) => {
    const req = await readJson(c);
    rejectExtra(req, ["ids"]);
    const ids = req.ids;
    const existing = new Set(ruleIds(db));
    if (
      !Array.isArray(ids) ||
      !ids.every((id) => Number.isSafeInteger(id) && existing.has(id as number)) ||
      new Set(ids).size !== ids.length ||
      ids.length !== existing.size
    ) {
      throw new BadRequest("ids deve conter cada regra existente exatamente uma vez");
    }
    reorderRules(db, ids as number[]);
    applyRules(db);
    return c.json(listRules(db));
  });

  app.post("/api/rules/preview", async (c) => {
    const req = await readJson(c);
    rejectExtra(req, ["pattern", "excludeRuleId"]);
    const pattern = parsePattern(req.pattern);
    const exclude = req.excludeRuleId;
    if (exclude !== undefined && !(typeof exclude === "number" && Number.isSafeInteger(exclude))) {
      throw new BadRequest("excludeRuleId deve ser inteiro");
    }
    return c.json(previewRule(db, pattern, exclude));
  });

  app.patch("/api/rules/:id", async (c) => {
    const current = getRule(db, parseId(c.req.param("id")));
    if (!current) return fail(c, 404, "regra não encontrada");
    updateRule(db, mergeRule(db, current, await readJson(c)));
    applyRules(db);
    return c.json(getRule(db, current.id));
  });

  app.delete("/api/rules/:id", (c) => {
    if (!deleteRule(db, parseId(c.req.param("id")))) return fail(c, 404, "regra não encontrada");
    applyRules(db);
    return c.body(null, 204);
  });

  // Mutex em memória: um sync por vez
  app.post("/api/sync", async (c) => {
    if (syncing) return fail(c, 409, "sincronização já em andamento");
    syncing = true;
    try {
      return c.json(await runSync());
    } finally {
      syncing = false;
    }
  });

  app.all("/api/*", (c) => fail(c, 404, "rota não encontrada"));

  // Front compilado (SPA): arquivos de web/dist, com fallback para index.html
  if (fs.existsSync(path.join(webDir, "index.html"))) {
    app.use("*", serveStatic({ root: webDir }));
    app.get("*", serveStatic({ root: webDir, path: "index.html" }));
  } else {
    app.get("/", (c) => c.text("Front não compilado: rode `npm run web:build` (ou `npm run dashboard`).\n"));
  }

  return app;
}
