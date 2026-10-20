import { test } from "node:test";
import assert from "node:assert/strict";
import { compileRule, compileRules, matchRule, normalize, type Rule } from "../src/categorize/rules.ts";

// Padrões e descrições sintéticos
const rule = (id: number, pattern: string, category: string, priority: number, enabled = true): Rule => ({
  id,
  pattern,
  category,
  priority,
  enabled,
});

test("normalize remove acentos e mantém o resto", () => {
  assert.equal(normalize("Pão de Açúcar Água ÉÇÃ"), "Pao de Acucar Agua ECA");
  assert.equal(normalize("loja 123 *x"), "loja 123 *x");
  assert.equal(normalize("café".normalize("NFC")), "cafe");
  assert.equal(normalize("café".normalize("NFD")), "cafe");
});

test("acento é ignorado no padrão e no texto, sem diferenciar maiúsculas", () => {
  const rules = compileRules([rule(1, "padaria s[aã]o jos[eé]", "Padaria", 10)]);
  assert.equal(matchRule(rules, "PADARIA SÃO JOSÉ LTDA")?.id, 1);
  assert.equal(matchRule(rules, "padaria sao jose")?.id, 1);
  const accented = compileRules([rule(2, "farmácia", "Saúde", 10)]);
  assert.equal(matchRule(accented, "FARMACIA CENTRAL")?.category, "Saúde");
  assert.equal(matchRule(accented, "Farmácia Central")?.category, "Saúde");
  assert.equal(matchRule(accented, "Mercado"), undefined);
});

test("compileRule valida vazio, tamanho e regex", () => {
  assert.throws(() => compileRule(""), /vazio/);
  assert.throws(() => compileRule("   "), /vazio/);
  assert.throws(() => compileRule("a".repeat(201)), /200/);
  assert.doesNotThrow(() => compileRule("a".repeat(200)));
  assert.throws(() => compileRule("(abc"), /regex inválida/);
  assert.throws(() => compileRule("[z-a]"), /regex inválida/);
  assert.equal(compileRule("^uber").flags, "i");
});

test("prioridade: menor priority vence; empate pelo menor id", () => {
  const rules = compileRules([
    rule(3, "mercado", "Mercado geral", 20),
    rule(2, "mercado bom", "Mercado bom", 10),
    rule(1, "mercado", "Empate id 1", 20),
  ]);
  assert.equal(matchRule(rules, "MERCADO BOM PRECO")?.id, 2);
  assert.equal(matchRule(rules, "MERCADO RUIM")?.id, 1);
  // a ordem de entrada não importa
  assert.equal(matchRule([...rules].reverse(), "MERCADO RUIM")?.id, 1);
});

test("regra desabilitada é pulada", () => {
  const rules = compileRules([rule(1, "posto", "Combustível", 10, false), rule(2, "posto|shell", "Carro", 20)]);
  assert.equal(matchRule(rules, "POSTO ABC")?.id, 2);
  assert.equal(matchRule(compileRules([rule(1, "posto", "X", 10, false)]), "POSTO ABC"), undefined);
});

test("compileRules pula padrão inválido sem lançar", () => {
  const rules = compileRules([rule(1, "(", "X", 10), rule(2, "ok", "Y", 20)]);
  assert.deepEqual(rules.map((r) => r.id), [2]);
});
