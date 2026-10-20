import { test } from "node:test";
import assert from "node:assert/strict";
import { daysBetween, toLocalDate } from "../src/sync/dates.ts";
import { fingerprint } from "../src/sync/fingerprint.ts";

test("toLocalDate: madrugada UTC ainda é o dia anterior em São Paulo", () => {
  assert.equal(toLocalDate("2026-03-01T02:00:00.000Z"), "2026-02-28");
  assert.equal(toLocalDate("2026-03-01T03:00:00.000Z"), "2026-03-01");
  assert.equal(toLocalDate("2026-01-01T02:59:59.000Z"), "2025-12-31");
});

test("toLocalDate: data inválida lança erro", () => {
  assert.throws(() => toLocalDate("nada"));
});

test("daysBetween: diferença absoluta", () => {
  assert.equal(daysBetween("2026-02-28", "2026-03-01"), 1);
  assert.equal(daysBetween("2026-03-01", "2026-02-28"), 1);
  assert.equal(daysBetween("2025-12-25", "2026-01-04"), 10);
  assert.equal(daysBetween("2026-05-05", "2026-05-05"), 0);
  assert.equal(daysBetween("2024-02-28", "2024-03-01"), 2); // bissexto
});

test("fingerprint: sha256 estável e sensível a cada campo", () => {
  const base = { date: "2026-04-10T15:00:00.000Z", amountCentsRaw: -1234, description: "PADARIA EXEMPLO", order: 3 };
  const fp = fingerprint(base);
  assert.match(fp, /^[0-9a-f]{64}$/);
  assert.equal(fingerprint({ ...base }), fp);
  assert.notEqual(fingerprint({ ...base, order: 4 }), fp);
  assert.notEqual(fingerprint({ ...base, amountCentsRaw: 1234 }), fp);
  assert.notEqual(fingerprint({ ...base, description: "PADARIA OUTRA" }), fp);
  // order ausente vira string vazia
  const { order: _o, ...noOrder } = base;
  assert.notEqual(fingerprint(noOrder), fp);
  assert.equal(fingerprint(noOrder), fingerprint({ ...noOrder, order: undefined }));
});
