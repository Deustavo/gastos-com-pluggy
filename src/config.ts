// Configuração vinda do ambiente (.env), compartilhada pelos scripts de sync e da API.

import { seedConnections, type Db } from "./db/index.ts";
import { PluggyClient } from "./providers/pluggy/client.ts";
import { PluggyProvider } from "./providers/pluggy/provider.ts";
import type { DataProvider } from "./providers/types.ts";

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variável ${name} não definida. Copie .env.example para .env e preencha.`);
  return value;
}

// Monta os providers e garante as conexões de PLUGGY_ITEM_IDS no banco.
export function setupProviders(db: Db): Record<string, DataProvider> {
  const client = new PluggyClient(requireEnv("PLUGGY_CLIENT_ID"), requireEnv("PLUGGY_CLIENT_SECRET"));
  const itemIds = requireEnv("PLUGGY_ITEM_IDS").split(",").map((s) => s.trim()).filter(Boolean);
  seedConnections(db, "pluggy", itemIds);
  return { pluggy: new PluggyProvider(client) };
}
