// Sugestão de padrão (regex) para uma regra de categorização a partir da descrição
// de uma transação. Função pura e propositalmente simples: o usuário revisa o padrão
// no formulário, com o teste ao vivo.

// Palavras que sozinhas não identificam o estabelecimento.
const STOPWORDS = new Set([
  "DE", "DA", "DO", "DAS", "DOS", "E", "EM", "NO", "NA", "COM", "PARA",
  "PIX", "TED", "DOC", "TRANSF", "TRANSFERENCIA", "ENVIADO", "ENVIADA", "RECEBIDO", "RECEBIDA",
  "COMPRA", "PAGAMENTO", "PAGTO", "PAG", "DEBITO", "CREDITO", "CARTAO", "PARCELA", "PARC",
]);

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

function normalize(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
}

function isSignificant(token: string): boolean {
  if (!/[\p{L}\p{N}]/u.test(token)) return false; // só pontuação
  if (token.length < 2) return false;
  if (STOPWORDS.has(normalize(token))) return false;
  if (/^\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?$/.test(token)) return false; // data
  if (/^[\d.,/-]+$/.test(token) && token.replace(/\D/g, "").length >= 3) return false; // número longo/valor
  if (/\d{5,}/.test(token)) return false; // código/ID com muitos dígitos
  return true;
}

// Tira o prefixo de adquirente ("PAG*", "IFD*", "MP *"): uma sigla de 2–3 caracteres antes do "*".
// Nos outros casos ("UBER *TRIP") o "*" vira espaço.
function stripAcquirer(description: string): string {
  return description.replace(/^\s*[\p{L}\p{N}]{2,3}\s?\*/u, "").replace(/\*/g, " ");
}

// Ex.: "IFD*RESTAURANTE SABOR 1234" → "RESTAURANTE SABOR"; "UBER *TRIP 0423" → "UBER".
// Usa as 2 primeiras palavras significativas quando são vizinhas na descrição; senão, só a primeira.
export function suggestRulePattern(description: string): string {
  const cleaned = stripAcquirer(description).trim();
  const tokens = cleaned
    .split(/\s+/)
    .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")) // pontuação nas pontas
    .filter(Boolean);
  const first = tokens.findIndex(isSignificant);
  if (first < 0) return escapeRegex(cleaned.split(/\s+/)[0] ?? "");
  const words = [tokens[first]!];
  const next = tokens[first + 1];
  if (next !== undefined && isSignificant(next)) words.push(next);
  if (words.length === 2 && !cleaned.includes(`${words[0]} ${words[1]}`)) return escapeRegex(words[0]!);
  return words.map(escapeRegex).join(" ");
}
