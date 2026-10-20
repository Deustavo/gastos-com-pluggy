// Fase 2 (`npm run api`): API local + front compilado, só em 127.0.0.1.

import { serve } from "@hono/node-server";
import { createApp } from "../src/api/app.ts";
import { setupProviders } from "../src/config.ts";
import { openDb } from "../src/db/index.ts";
import { SyncService } from "../src/sync/sync.ts";

const HOSTNAME = "127.0.0.1"; // nunca 0.0.0.0

function main(): void {
  const port = Number(process.env.PORT ?? 8787);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`PORT inválida: ${process.env.PORT}`);

  const db = openDb();
  const sync = new SyncService(db, setupProviders(db));
  const app = createApp({ db, runSync: () => sync.run() });

  const server = serve({ fetch: app.fetch, hostname: HOSTNAME, port }, (info) => {
    console.log(`API em http://${HOSTNAME}:${info.port}`);
  });

  const stop = () => {
    server.close();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
