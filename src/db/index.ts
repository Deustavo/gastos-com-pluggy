// Abre o SQLite local, garantindo permissões restritas, e aplica schema, migrações e views.

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type Db = Database.Database;

const SCHEMA = fs.readFileSync(path.join(import.meta.dirname, "schema.sql"), "utf8");
const VIEWS = fs.readFileSync(path.join(import.meta.dirname, "views.sql"), "utf8");

// Migrações em ordem; a de índice i leva o banco à versão i + 1 (PRAGMA user_version).
// Banco novo e banco antigo passam pelas mesmas migrações, então chegam ao mesmo schema.
// Nunca editar uma migração já aplicada: acrescentar outra no fim.
const MIGRATIONS: ((db: Db) => void)[] = [
  // 1 (fase 3): regras locais e tradução das categorias do fornecedor
  (db) => {
    addColumn(db, "transactions", "rule_id", "INTEGER");
    addColumn(db, "transactions", "rule_category", "TEXT");
    db.exec(`
      CREATE TABLE IF NOT EXISTS category_rules (
        id INTEGER PRIMARY KEY,
        pattern TEXT NOT NULL,
        category TEXT NOT NULL,
        priority INTEGER NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );
      -- name = texto original do fornecedor (o mesmo de transactions.category)
      CREATE TABLE IF NOT EXISTS provider_categories (
        provider TEXT NOT NULL,
        name TEXT NOT NULL,
        name_pt TEXT NOT NULL,
        PRIMARY KEY (provider, name)
      );`);
  },
];

export const SCHEMA_VERSION = MIGRATIONS.length;

function addColumn(db: Db, table: string, column: string, type: string): void {
  const cols = db.pragma(`table_info(${table})`) as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

function migrate(db: Db): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  if (current > MIGRATIONS.length) throw new Error(`banco na versão ${current}, código conhece até ${MIGRATIONS.length}`);
  db.transaction(() => {
    db.exec("DROP VIEW IF EXISTS v_transactions"); // depende das colunas; recriada em VIEWS
    MIGRATIONS.slice(current).forEach((m, i) => {
      m(db);
      db.pragma(`user_version = ${current + i + 1}`);
    });
    db.exec(VIEWS);
  })();
}

export function openDb(file = "data/app.db"): Db {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  // Cria o arquivo com 0600 antes do SQLite abrir; o chmod cobre arquivo já existente.
  fs.closeSync(fs.openSync(file, "a", 0o600));
  fs.chmodSync(file, 0o600);

  const db = new Database(file);
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

// Insere as conexões que ainda não existem (ex.: a partir de PLUGGY_ITEM_IDS).
export function seedConnections(db: Db, provider: string, externalIds: string[]): void {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO connections (provider, external_id, created_at) VALUES (?, ?, ?)",
  );
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const id of externalIds) insert.run(provider, id, now);
  })();
}
