// Natureza do gasto: fixo ou variável.
// Cada transação ganha uma chave de recorrência (o estabelecimento normalizado). A marcação
// manual é gravada por chave (nature_marks), então vale para os meses passados e para os que
// ainda vão chegar. Sem marcação, a detecção automática decide; o padrão é variável.

import type { Db } from "../db/index.ts";
import { normalize } from "./rules.ts";

export type Nature = "fixed" | "variable";
export const NATURES: readonly Nature[] = ["fixed", "variable"];

// Detecção: o estabelecimento aparece em pelo menos MIN_MONTHS meses, em quase todos os meses
// do intervalo, em média até MAX_PER_MONTH vezes por mês e com total mensal parecido.
const MIN_MONTHS = 3;
const MIN_PRESENCE = 0.75; // meses com a chave / meses entre o primeiro e o último
const MAX_PER_MONTH = 1.5;
const AMOUNT_TOLERANCE = 0.2; // ±20% da mediana mensal
const MIN_STABLE = 0.8; // fração dos meses dentro da tolerância

// Fatura de cartão: nome com 22 posições, cidade com 13 e país ("DL UBERRIDES    SAO PAULO     BRA").
// Ficar só com o nome junta esse formato com o antigo ("Dl *Uberrides").
const CARD_LAYOUT_RE = /^(.{22}) .{13} [A-Za-z]{2,3}$/;

// Ex.: "Amazon Ad Free For Pri" e "AMAZON AD FREE FOR PRI SAO PAULO     BRA" → "AMAZONADFREEFORPRI".
// Tokens longos com dígitos (IDs de recarga, códigos) somem; nos curtos só os dígitos somem
// ("DROGASIL2204" → "DROGASIL"). null quando não sobra nada que identifique.
export function recurrenceKey(description: string | null): string | null {
  if (!description) return null;
  const name = CARD_LAYOUT_RE.exec(description)?.[1] ?? description;
  const tokens = normalize(name).toUpperCase().split(/[\s\-–]+/);
  const key = tokens
    .filter((t) => !(t.length >= 16 && /\d/.test(t)))
    .map((t) => t.replace(/[^A-Z]/g, ""))
    .join("");
  if (key.length >= 3) return key;
  const fallback = normalize(name).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return fallback.length >= 3 ? fallback : null;
}

export interface NatureSample {
  key: string;
  month: string; // YYYY-MM
  amountCents: number; // valor absoluto
}

const monthIndex = (m: string): number => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7));

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

// Chaves que se comportam como gasto fixo (só gastos, sem estornos nem parcelas).
export function detectFixedKeys(samples: NatureSample[]): Set<string> {
  const byKey = new Map<string, Map<string, { total: number; count: number }>>();
  for (const s of samples) {
    const months = byKey.get(s.key) ?? new Map<string, { total: number; count: number }>();
    const m = months.get(s.month) ?? { total: 0, count: 0 };
    m.total += s.amountCents;
    m.count++;
    months.set(s.month, m);
    byKey.set(s.key, months);
  }

  const fixed = new Set<string>();
  for (const [key, months] of byKey) {
    if (months.size < MIN_MONTHS) continue;
    const idx = [...months.keys()].map(monthIndex);
    const span = Math.max(...idx) - Math.min(...idx) + 1;
    if (months.size / span < MIN_PRESENCE) continue;
    const stats = [...months.values()];
    if (stats.reduce((n, m) => n + m.count, 0) / months.size > MAX_PER_MONTH) continue;
    const med = median(stats.map((m) => m.total));
    const stable = stats.filter((m) => Math.abs(m.total - med) <= med * AMOUNT_TOLERANCE).length;
    if (stable / months.size >= MIN_STABLE) fixed.add(key);
  }
  return fixed;
}

// Recalcula recurrence_key e auto_nature de todas as transações (como applyRules).
// auto_nature = 'fixed' para parcela ou chave detectada; NULL no resto (vira variável na view).
// A detecção ignora as transações marcadas como ignoradas.
export function applyNature(db: Db): void {
  const txs = db
    .prepare(`
      SELECT t.id, t.description, t.kind, t.local_date, t.amount_cents_abs, t.total_installments,
        COALESCE(o.ignored, 0) AS ignored
      FROM transactions t LEFT JOIN overrides o ON o.fingerprint = t.fingerprint`)
    .all() as {
    id: number;
    description: string | null;
    kind: string | null;
    local_date: string;
    amount_cents_abs: number;
    total_installments: number | null;
    ignored: number;
  }[];

  const keyed = txs.map((t) => ({ ...t, key: recurrenceKey(t.description), installment: (t.total_installments ?? 0) > 1 }));
  const fixed = detectFixedKeys(
    keyed
      .filter((t) => t.key !== null && t.kind === "expense" && !t.installment && t.ignored === 0)
      .map((t) => ({ key: t.key!, month: t.local_date.slice(0, 7), amountCents: t.amount_cents_abs })),
  );

  const update = db.prepare("UPDATE transactions SET recurrence_key = ?, auto_nature = ? WHERE id = ?");
  db.transaction(() => {
    for (const t of keyed) {
      const auto = t.installment || (t.key !== null && fixed.has(t.key)) ? "fixed" : null;
      update.run(t.key, auto, t.id);
    }
  })();
}
