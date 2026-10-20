import { test } from "node:test";
import assert from "node:assert/strict";
import { detectFixedKeys, recurrenceKey, type NatureSample } from "../src/categorize/nature.ts";

// Descrições sintéticas no formato dos extratos
test("recurrenceKey junta formatos diferentes do mesmo estabelecimento", () => {
  // fatura: nome em 22 posições, cidade em 13 e país
  const card = (name: string, city: string, country = "BRA") => `${name.padEnd(22)} ${city.padEnd(13)} ${country}`;
  const key = recurrenceKey("Streaming Ad Free For");
  assert.equal(key, "STREAMINGADFREEFOR");
  assert.equal(recurrenceKey(card("STREAMING AD FREE FOR", "SAO PAULO")), key);
  assert.equal(recurrenceKey(card("STREAMING  AI SUB", "SAN FRANCISCO", "CA")), "STREAMINGAISUB");
  assert.equal(recurrenceKey("Dl *Uberrides"), "DLUBERRIDES");
  assert.equal(recurrenceKey(card("DL UBERRIDES", "SAO PAULO")), "DLUBERRIDES");
  assert.equal(recurrenceKey("Farmácia São João"), "FARMACIASAOJOAO");
});

test("recurrenceKey descarta IDs longos e dígitos soltos", () => {
  const a = recurrenceKey("Deb Recarga Transporte - Bilhete Único - 01kbtk0wd5derxfvht2fpbs1rk");
  const b = recurrenceKey("Deb Recarga Transporte - Bilhete Único - 01kd59sr3aqan0z0w36x0fkzrv");
  assert.equal(a, "DEBRECARGATRANSPORTEBILHETEUNICO");
  assert.equal(a, b);
  assert.equal(recurrenceKey("DROGARIA 2204"), "DROGARIA");
  assert.equal(recurrenceKey("12345678"), "12345678"); // sem letras: usa os dígitos
  assert.equal(recurrenceKey("ab"), null);
  assert.equal(recurrenceKey(""), null);
  assert.equal(recurrenceKey(null), null);
});

const monthly = (key: string, amounts: number[], start = 1): NatureSample[] =>
  amounts.map((amountCents, i) => ({ key, month: `2026-${String(start + i).padStart(2, "0")}`, amountCents }));

test("detecta mensal com valor parecido; ignora poucas ocorrências, valor instável e muitas por mês", () => {
  const samples = [
    ...monthly("ASSINATURA", [1490, 1490, 1490, 1490]),
    ...monthly("CONTADOR", [20000, 20000, 21000, 19500, 20000]),
    ...monthly("NOVA", [990, 990]), // só 2 meses
    ...monthly("MERCADO", [10000, 35000, 4000, 22000]), // valor varia
    ...monthly("APP", [1000, 1000, 1000]),
    ...monthly("APP", [1000, 1000, 1000]), // 2 por mês
  ];
  assert.deepEqual([...detectFixedKeys(samples)].sort(), ["ASSINATURA", "CONTADOR"]);
});

test("tolera um mês fora do padrão, mas não buracos grandes", () => {
  const outlier = monthly("LUZ", [15000, 15500, 30000, 14800, 15200]); // 1 de 5 fora
  const gaps = [1, 4, 8, 12].map((m) => ({ key: "ANUAL", month: `2026-${String(m).padStart(2, "0")}`, amountCents: 5000 }));
  assert.deepEqual([...detectFixedKeys([...outlier, ...gaps])], ["LUZ"]);
});
