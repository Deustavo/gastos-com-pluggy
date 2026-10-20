import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalCategory, MAX_CATEGORY_LENGTH, parseCategory } from "../src/categorize/categories.ts";

test("parseCategory limpa espaços e valida", () => {
  assert.equal(parseCategory("  Limpeza   da  casa "), "Limpeza da casa");
  assert.equal(parseCategory("x".repeat(MAX_CATEGORY_LENGTH)), "x".repeat(MAX_CATEGORY_LENGTH));
  for (const v of ["", "   ", "x".repeat(MAX_CATEGORY_LENGTH + 1), 1, null, undefined]) {
    assert.throws(() => parseCategory(v), /category deve ser texto não vazio/);
  }
});

test("canonicalCategory reaproveita a grafia existente, sem diferenciar maiúscula ou acento", () => {
  const existing = ["Limpeza da casa", "Saúde"];
  assert.equal(canonicalCategory("limpeza da CASA", existing), "Limpeza da casa");
  assert.equal(canonicalCategory("saude", existing), "Saúde");
  assert.equal(canonicalCategory("Lazer", existing), "Lazer");
});
