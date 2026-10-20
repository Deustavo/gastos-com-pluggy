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
import type { ApiError, OverrideRequest, OverrideResponse } from "./contract.ts";
import {
  fingerprintExists,
  getOverride,
  getSummary,
  listCategories,
  listConnections,
  listTransactions,
  saveOverride,
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

// Aplica o PATCH sobre o override atual; campos ausentes ficam como estão.
function mergeOverride(current: OverrideResponse, body: unknown): OverrideResponse {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new BadRequest("corpo deve ser um objeto JSON");
  const req = body as Record<string, unknown>;
  const extra = Object.keys(req).filter((k) => !["category", "ignored", "note"].includes(k));
  if (extra.length) throw new BadRequest(`campos desconhecidos: ${extra.join(", ")}`);
  const next = { ...current };

  if ("category" in req) {
    const v = req.category as OverrideRequest["category"];
    if (v === null) next.category = null;
    else if (typeof v === "string" && v.trim() !== "" && v.trim().length <= 60) next.category = v.trim();
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

  // CSRF: métodos que alteram estado exigem JSON e, se houver Origin, que seja local
  app.use("*", async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next();
    const origin = c.req.header("origin");
    if (origin !== undefined && !LOCAL_ORIGIN_RE.test(origin)) return fail(c, 403, "origem não permitida");
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
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw new BadRequest("JSON inválido");
    }
    const next = mergeOverride(getOverride(db, fp), body);
    saveOverride(db, next);
    return c.json(next);
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
