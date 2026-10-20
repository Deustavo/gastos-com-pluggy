# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

App **pessoal e local** (só nesta máquina) que lê conta corrente e cartão de crédito via
Open Finance (MeuPluggy + API da Pluggy, somente leitura), grava em SQLite e mostra os gastos
num dashboard no navegador. Código, comentários, mensagens de erro e docs são em pt-BR.

Contexto completo: [docs/PLANO.md](docs/PLANO.md) (decisões, regras de "gasto", riscos) e
[docs/PROXIMOS_PASSOS.md](docs/PROXIMOS_PASSOS.md) (estado de cada fase e pendências).
Atualize o `PROXIMOS_PASSOS.md` ao concluir uma etapa.

## Comandos

Node >= 22, TypeScript executado direto com `tsx` (sem build do backend).

- `npm test` — todos os testes (`node:test`, sem framework). Um arquivo só:
  `node --import tsx --test test/rules.test.ts`. Um teste pelo nome: acrescentar
  `--test-name-pattern="trecho do nome"`.
- `npm run typecheck` — `tsc` do backend (`src`, `scripts`, `test`) e do front (`-p web`).
- `npm run sync` — sincroniza todas as conexões para `data/app.db` (exit 1 se alguma falhar).
- `npm run dashboard` — build do front + API servindo tudo em http://127.0.0.1:8787.
- Desenvolvimento: `npm run api` (8787) + `npm run web:dev` (Vite em 127.0.0.1:5173, proxy de `/api`).
- `WEB_MOCK=1 npm run web:dev` — front com dados sintéticos, sem API (mock em `web/mock/`, fora do build).
- `npm run spike` — fase 0: salva JSON bruto da Pluggy em `data/raw/`.

## Regras obrigatórias (dados financeiros reais)

- **Nunca ler nem imprimir o `.env`.** Os scripts carregam com `--env-file=.env`.
- Ao analisar `data/raw/` ou `data/app.db`, imprimir **só agregados** (contagens, somas,
  percentuais), nunca descrições ou valores individuais. O resumo do `sync` segue a mesma regra.
- Fixtures de teste são **sempre sintéticas**; nunca copiar dados de `data/`.
- `PluggyClient` ([src/providers/pluggy/client.ts](src/providers/pluggy/client.ts)) é somente
  leitura de propósito: o único POST é `/auth` e não há método genérico de request. Rota nova
  precisa ser GET da API de dados e entrar explicitamente em `ALLOWED_READ_PATHS`. Nunca usar
  endpoints de pagamento nem `/categories/rules`.
- A API só faz bind em `127.0.0.1`. [src/api/app.ts](src/api/app.ts) rejeita Host não local
  (DNS rebinding), exige `Content-Type: application/json` + Origin local em métodos de escrita
  (CSRF), não tem CORS e devolve 500 genérico. Manter isso em rotas novas.

## Arquitetura

```
npm run sync ─▶ SyncService ─▶ SQLite (data/app.db) ◀─ API Hono ◀─ React (web/)
                    │                                   POST /api/sync chama o mesmo SyncService
          DataProvider (src/providers/types.ts)
          └── PluggyProvider (1 itemId MeuPluggy = 1 banco)
```

- **Providers** convertem para tipos normalizados em `src/providers/types.ts`. O sinal do
  `amount` é oposto entre conta corrente e cartão; cada provider resolve isso em `direction`
  (IN/OUT) + `amountCentsAbs`. Valores sempre em **centavos inteiros**.
- **Sync** ([src/sync/sync.ts](src/sync/sync.ts)): por conexão, busca 365 dias e **substitui**
  (DELETE + INSERT numa transação SQL) as transações da conta dentro da janela — não há upsert
  por id, porque o id da Pluggy muda perto do fechamento da fatura. Depois, de forma **global**
  (a fatura de um banco pode ser paga por outro): `classify` → `applyRules` → `applyNature`, e a
  checagem de integridade (soma das compras de cada `billId`, sem `card_payment`, = `totalAmount`).
  Uma conexão com erro não impede as outras.
- **Fingerprint** (`date|amount|description|order`) é a chave estável de uma transação. Edições
  manuais (`overrides`: categoria, ignorar) usam essa chave e sobrevivem aos re-syncs.
- **`kind`** (`expense`, `refund`, `income`, `transfer`, `card_payment`) vem de
  [src/sync/classify.ts](src/sync/classify.ts) com base na categoria **original** do fornecedor;
  regras locais mudam a categoria exibida, nunca o que conta como gasto.
  Gasto do mês = Σ expense − Σ refund, sem `ignored` e sem `PENDING`, mês pelo `local_date`
  (America/Sao_Paulo; datas chegam em UTC).
- **Categoria efetiva**: override manual > regra local (`category_rules`, regex sem acento e
  case-insensitive, primeira habilitada por `priority`) > tradução pt-BR da categoria do fornecedor.
  Validação/normalização de nomes em [src/categorize/categories.ts](src/categorize/categories.ts).
  Após qualquer mudança de regra a API roda `applyRules` de novo.
- **Natureza fixo/variável** ([src/categorize/nature.ts](src/categorize/nature.ts)): cada
  transação ganha uma `recurrence_key` (estabelecimento normalizado); marcação manual fica em
  `nature_marks` por chave (vale para meses passados e futuros); sem marcação, detecção automática.
- **Banco**: [src/db/index.ts](src/db/index.ts) cria `data/app.db` com permissão 600.
  `schema.sql` está congelado; mudanças de schema entram como nova função no fim de `MIGRATIONS`
  (`PRAGMA user_version`) — nunca editar uma migração já aplicada. A view `v_transactions`
  ([src/db/views.sql](src/db/views.sql)) aplica overrides/regras e é recriada a cada migração;
  as consultas da API ([src/api/queries.ts](src/api/queries.ts)) leem dela.
- **Contrato HTTP**: [src/api/contract.ts](src/api/contract.ts) só tem tipos, importados pela API,
  pelo front ([web/src/api.ts](web/src/api.ts)) e pelo mock. Ao mudar uma rota, atualizar os três.
- **Front** (`web/`): Vite + React + Recharts. Busca o mês inteiro e filtra no cliente. O modo
  "ocultar valores" ([web/src/privacy.ts](web/src/privacy.ts)) borra o dinheiro via CSS; quem
  exibe valores deve passar por ele.
- Testes da API usam `createApp` com um banco temporário e dados inseridos direto (ver
  [test/api.test.ts](test/api.test.ts)).
