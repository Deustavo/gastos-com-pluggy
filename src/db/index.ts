// Abre o SQLite local, garantindo permissões restritas, e aplica o schema.

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type Db = Database.Database;

const SCHEMA = fs.readFileSync(path.join(import.meta.dirname, "schema.sql"), "utf8");

export function openDb(file = "data/app.db"): Db {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  // Cria o arquivo com 0600 antes do SQLite abrir; o chmod cobre arquivo já existente.
  fs.closeSync(fs.openSync(file, "a", 0o600));
  fs.chmodSync(file, 0o600);

  const db = new Database(file);
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
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
