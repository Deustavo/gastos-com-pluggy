// Nome de categoria: o único ponto que define o que é válido e como se grava.
// Categoria é texto livre (override, regra ou fornecedor); não há tabela própria.

import { normalize } from "./rules.ts";

export const MAX_CATEGORY_LENGTH = 60;
export const NO_CATEGORY = "Sem categoria";
// Categorias próprias, sempre oferecidas na escolha mesmo sem transação, regra ou fornecedor.
// Para criar uma fixa, basta incluir aqui.
export const EXTRA_CATEGORIES = ["Limpeza da casa"];

// Chave de comparação: sem acento, sem diferenciar maiúsculas.
const key = (name: string): string => normalize(name).toLocaleLowerCase("pt-BR");

// Valida e limpa (trim e espaços internos repetidos); lança Error com mensagem em português.
export function parseCategory(value: unknown): string {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (name === "" || name.length > MAX_CATEGORY_LENGTH) {
    throw new Error(`category deve ser texto não vazio de até ${MAX_CATEGORY_LENGTH} caracteres`);
  }
  return name;
}

// Reaproveita a grafia de uma categoria já existente ("limpeza da casa" → "Limpeza da casa"),
// para não nascerem duplicatas que só diferem em maiúscula ou acento.
export function canonicalCategory(name: string, existing: readonly string[]): string {
  const k = key(name);
  return existing.find((c) => key(c) === k) ?? name;
}
