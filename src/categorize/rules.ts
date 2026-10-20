// Regras locais de categorização: regex sobre a descrição, sem acentos dos dois lados.
// A regra só define a categoria exibida (rule_category); o kind continua vindo do fornecedor.

import type { Db } from "../db/index.ts";

export const MAX_PATTERN_LENGTH = 200;

export interface Rule {
  id: number;
  pattern: string;
  category: string;
  priority: number;
  enabled: boolean;
}

export interface CompiledRule extends Rule {
  re: RegExp;
}

export function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "");
}

// Valida e compila; lança Error com mensagem em português.
export function compileRule(pattern: string): RegExp {
  if (pattern.trim() === "") throw new Error("pattern não pode ser vazio");
  if (pattern.length > MAX_PATTERN_LENGTH) throw new Error(`pattern deve ter até ${MAX_PATTERN_LENGTH} caracteres`);
  try {
    return new RegExp(normalize(pattern), "i");
  } catch (e) {
    throw new Error(`regex inválida: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// Ordem de aplicação: priority asc, empate por id asc.
export const byPriority = (a: Rule, b: Rule): number => a.priority - b.priority || a.id - b.id;

// Compila as regras do banco; uma regra inválida (não deveria existir) é pulada.
export function compileRules(rules: Rule[]): CompiledRule[] {
  const out: CompiledRule[] = [];
  for (const r of rules) {
    try {
      out.push({ ...r, re: compileRule(r.pattern) });
    } catch {
      // validada na API; ignorar aqui evita derrubar o sync
    }
  }
  return out.sort(byPriority);
}

// Primeira regra habilitada que casa, na ordem de aplicação.
export function matchRule<T extends CompiledRule>(rules: readonly T[], description: string): T | undefined {
  const text = normalize(description);
  return [...rules].sort(byPriority).find((r) => r.enabled && r.re.test(text));
}

interface RuleDbRow {
  id: number;
  pattern: string;
  category: string;
  priority: number;
  enabled: number;
}

export function loadRules(db: Db): Rule[] {
  return (db.prepare("SELECT id, pattern, category, priority, enabled FROM category_rules").all() as RuleDbRow[]).map(
    (r) => ({ ...r, enabled: r.enabled === 1 }),
  );
}

// Recalcula rule_id/rule_category de todas as transações (são poucas mil) numa transação SQL.
export function applyRules(db: Db): void {
  const rules = compileRules(loadRules(db)).filter((r) => r.enabled);
  const txs = db.prepare("SELECT id, description FROM transactions").all() as { id: number; description: string | null }[];
  const update = db.prepare("UPDATE transactions SET rule_id = ?, rule_category = ? WHERE id = ?");
  db.transaction(() => {
    for (const t of txs) {
      const r = matchRule(rules, t.description ?? "");
      update.run(r?.id ?? null, r?.category ?? null, t.id);
    }
  })();
}
