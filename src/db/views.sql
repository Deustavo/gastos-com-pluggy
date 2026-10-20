-- Leitura da API: transações com tradução, regras e overrides aplicados.
-- Recriada a cada abertura, depois das migrações (t.* é fixado na criação).
-- Precedência da categoria: override > regra > fornecedor (pt-BR, ou o original sem tradução).
DROP VIEW IF EXISTS v_transactions;
CREATE VIEW v_transactions AS
SELECT
  t.*,
  COALESCE(pc.name_pt, t.category) AS provider_category_pt,
  COALESCE(o.category, t.rule_category, pc.name_pt, t.category) AS effective_category,
  CASE
    WHEN o.category IS NOT NULL THEN 'override'
    WHEN t.rule_category IS NOT NULL THEN 'rule'
    WHEN NULLIF(TRIM(COALESCE(pc.name_pt, t.category)), '') IS NOT NULL THEN 'provider'
    ELSE 'none'
  END AS category_source,
  COALESCE(o.ignored, 0) AS ignored,
  o.category AS override_category,
  o.note AS override_note,
  -- Natureza só existe para gasto e estorno. Precedência: marcação manual > detecção > variável.
  CASE WHEN t.kind IN ('expense', 'refund') THEN COALESCE(nm.nature, t.auto_nature, 'variable') END AS nature,
  CASE WHEN t.kind IN ('expense', 'refund') THEN
    CASE WHEN nm.nature IS NOT NULL THEN 'manual' WHEN t.auto_nature IS NOT NULL THEN 'detected' ELSE 'default' END
  END AS nature_source
FROM transactions t
LEFT JOIN accounts a ON a.id = t.account_id
LEFT JOIN connections c ON c.id = a.connection_id
LEFT JOIN provider_categories pc ON pc.provider = c.provider AND pc.name = t.category
LEFT JOIN overrides o ON o.fingerprint = t.fingerprint
LEFT JOIN nature_marks nm ON nm.recurrence_key = t.recurrence_key;
