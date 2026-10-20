# Próximos passos (handoff)

> Para retomar numa sessão nova: *"Leia `docs/PROXIMOS_PASSOS.md` e `docs/PLANO.md` e comece a fase 4."*
> Estado em **2026-10-20** (fases 1, 2 e 3 concluídas).

## Contexto em 30 segundos

App **pessoal e local** (só nesta máquina) que lê **conta corrente e cartão de
crédito** do Inter PF via Open Finance e mostra os gastos num **dashboard no
navegador**. Precisa suportar **N bancos** e usar **permissões somente leitura**.
A stack é TypeScript com Node 22.

- Pessoa física não acessa o Open Finance diretamente, e a API do Inter é só PJ.
  A fonte de dados é o **MeuPluggy + conector MeuPluggy** da API da Pluggy:
  gratuito, uso pessoal, até 5 conexões.
- Decisões, arquitetura e riscos estão em [`PLANO.md`](PLANO.md). Este arquivo
  traz só o que falta fazer.

## O que já existe

| Arquivo | O que é |
|---|---|
| `src/providers/pluggy/client.ts` | Cliente **somente leitura** (GET só em `/items/:id`, `/accounts`, `/v2/transactions`, `/bills`; o único POST é `/auth`). Renova a API key sozinho (vale 2h) e tenta de novo em caso de 429. |
| `scripts/spike.ts` | Fase 0 (`npm run spike`): imprime um resumo e salva o JSON bruto em `data/raw/<itemId>/` com permissão 600 |
| `docs/PLANO.md` | Plano, regras de "gasto" e riscos (atualizado com o que a fase 0 mostrou) |
| `.env` | `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET`, `PLUGGY_ITEM_IDS` (1 item hoje: Inter) |
| `package.json` | Dependências de dev: `tsx`, `typescript`, `@types/node`. Scripts `spike` e `typecheck`. |

Fase 1 (pronta):

| Arquivo | O que é |
|---|---|
| `src/providers/types.ts` | Contrato `DataProvider` e tipos normalizados (`direction` IN/OUT já resolve o sinal oposto entre conta e cartão) |
| `src/providers/pluggy/provider.ts` | `PluggyProvider` |
| `src/db/schema.sql`, `src/db/index.ts` | Schema idempotente, `openDb()` (cria `data/app.db` com 600), `seedConnections()`; view `v_transactions` com overrides aplicados (`effective_category`, `ignored`). **A fase 2 lê dessa view.** |
| `src/sync/sync.ts` | `SyncService.run()` → `SyncReport` (sem console; reutilizável pelo botão "sincronizar agora") |
| `src/sync/{classify,integrity,fingerprint,dates}.ts` | Funções puras |
| `scripts/sync.ts` | `npm run sync` (resumo agregado; exit 1 se alguma conexão falhar) |
| `test/` | `npm test`: 24 testes, fixtures sintéticas |

## Fatos validados na fase 0 (dados reais do Inter)

- Item: conector `MeuPluggy` com `isOpenFinance=false`, status `UPDATED`/`SUCCESS`,
  `consentExpiresAt = 2027-10-20`.
- Contas: `BANK/CHECKING_ACCOUNT` (304 transações), `BANK/SAVINGS_ACCOUNT` (0) e
  `CREDIT/CREDIT_CARD` (401 transações, 21 delas `PENDING`), mais 13 faturas.
  São cerca de 12 meses de histórico.
- **`providerId` e `providerCode` vêm sempre vazios.** O `id` da Pluggy muda nas
  transações de cartão perto do fechamento da fatura, então **não serve como chave**.
- `date + amount + description + order` foi **único em 100%** das transações.
- `category` vem preenchida em 100% delas. `merchant` vem em 15–24%.
  `paymentData` vem em 100% na conta corrente.
- O sinal é **oposto** entre os tipos de conta:
  - conta corrente: `DEBIT` tem `amount < 0` e `CREDIT` tem `amount > 0`;
  - cartão: `DEBIT` tem `amount > 0` (compra) e `CREDIT` tem `amount < 0`
    (pagamento ou estorno).
- Cartão: 95% das transações têm `creditCardMetadata.billId`. As 21 pendentes
  não têm `billId`, mas têm `billForecastDate` (`YYYY-MM`).
- **Integridade:** em todas as 13 faturas, a soma das compras com aquele `billId`
  é igual ao `totalAmount` da fatura. O pagamento da fatura anterior aparece
  como transação negativa dentro da fatura seguinte.
- Na conta corrente aparecem muitas transações das categorias `Investments`,
  `Fixed income` e `Same person transfer*`, que **não são gasto**.
- O `operationType` do cartão é quase sempre `PAGAMENTO` (que significa compra).
  Não aparece `PAGAMENTO_FATURA`.

## Fase 1: sincronização para SQLite (concluída em 2026-10-20)

### Resultado com os dados reais

- 2 execuções seguidas com contagens idênticas: conta corrente 304 (expense 144, transfer 120, income 29, card_payment 11); cartão 401 (expense 386, card_payment 11, refund 4); 13 faturas.
- Integridade: **11 faturas ok, 2 `out_of_window`, 0 divergências**. As 2 mais antigas têm o ciclo começando antes da janela de 365 dias (transações incompletas), por isso não são comparadas. A conta da integridade **exclui os pagamentos de fatura** (`card_payment`); sem isso só 1 bate.
- Pagamentos de fatura caem entre −6 e 0 dias do vencimento, dentro da tolerância de ±10.
- Classificação é um passo **global** após todas as conexões, porque a fatura de um banco pode ser paga pela conta de outro.
- O DELETE da janela começa no mínimo entre `from` e a transação mais antiga recebida, para não duplicar se o fornecedor arredondar a data.

### Observações para depois

- 1 transação `PENDING` do cartão foi classificada como `card_payment` (provável pagamento ainda não confirmado). Conferir quando confirmar.
- `listTransactions`/`listBills` do provider recebem `Account` (não só o id), porque a direção depende do tipo da conta.

### Especificação original

### Dependências

- `better-sqlite3` com versão exata (`--save-exact`). Evitar o `node:sqlite`,
  que ainda é experimental no Node 22.
- Testes com `node --import tsx --test`, sem framework extra.

### Estrutura

```
src/
  providers/
    types.ts              DataProvider + tipos normalizados (independentes da Pluggy)
    pluggy/client.ts      (já existe)
    pluggy/provider.ts    PluggyProvider: client → tipos normalizados
  db/
    schema.sql
    index.ts              abre data/app.db (cria com 0600), aplica o schema
  sync/
    sync.ts               orquestra por conexão
    classify.ts           define kind (gasto, receita etc.), função pura e testável
    integrity.ts          confere compras × fatura, função pura
scripts/sync.ts           CLI: `npm run sync`
test/                     fixtures SINTÉTICAS (nunca copiar dados reais de data/raw)
```

### Interface do provider (rascunho)

```ts
interface DataProvider {
  getConnectionStatus(externalId: string): Promise<ConnectionStatus>; // status, lastUpdatedAt, consentExpiresAt, erro
  listAccounts(externalId: string): Promise<Account[]>;
  listTransactions(accountId: string, range: { from: Date; to?: Date }): AsyncIterable<Transaction>;
  listBills(accountId: string): Promise<Bill[]>; // [] para contas que não são cartão
}
```

### Schema (rascunho)

Valores em **centavos (INTEGER)**. Datas guardadas em ISO UTC, mais `local_date`
calculado em `America/Sao_Paulo`.

- `connections(id, provider, external_id, nickname, created_at)`. Na primeira
  execução, criar as conexões a partir de `PLUGGY_ITEM_IDS`.
- `accounts(id, connection_id, type, subtype, name, number_last4, currency, balance_cents, updated_at)`
- `transactions(id INTEGER PK, account_id, provider_tx_id, fingerprint, date, local_date, description, description_raw, amount_cents_raw, direction IN|OUT, amount_cents_abs, status, category, operation_type, bill_id, bill_forecast, installment_number, total_installments, kind, synced_at)`
  - `fingerprint` = hash de `date|amount|description|order`
- `bills(id, account_id, due_date, total_cents, minimum_cents)`
- `overrides(fingerprint PK, category, ignored, note)`: edições manuais, sobrevivem aos re-syncs
- `sync_runs(id, connection_id, started_at, finished_at, status, error, tx_count)`

### Algoritmo do sync

Para cada conexão:

1. Chamar `getConnectionStatus`.
   - Se houver erro, ou se `consentExpiresAt` já passou, registrar em
     `sync_runs` e seguir para a próxima conexão.
   - Se faltarem menos de 30 dias para `consentExpiresAt`, avisar.
2. Fazer upsert das contas.
3. Para cada conta, buscar 365 dias de transações. Depois, **numa única transação
   SQL**, apagar as transações dessa conta com `date >= from` e inserir as que
   foram buscadas. As linhas mais antigas ficam como histórico.
4. Substituir as faturas das contas de cartão.
5. Rodar `classify` e aplicar `overrides` (pelo `fingerprint`).
6. Rodar `integrity`: para cada fatura, somar as compras com o mesmo `billId` e
   comparar com `total_cents`. Se divergir, avisar (sem falhar).
7. Gravar um resumo **agregado** no terminal (contagens por conta e alertas).
   Nunca imprimir descrições nem valores individuais.

### Regras do `classify` (valor de `kind`)

| Conta | Condição | kind |
|---|---|---|
| Cartão | `amount > 0` | `expense` |
| Cartão | `amount < 0`, com valor absoluto igual ao `total_cents` de uma fatura anterior | `card_payment` (não é gasto) |
| Cartão | outros casos com `amount < 0` | `refund` (abate do gasto) |
| Conta | `amount < 0`, com valor igual ao `total_cents` de alguma fatura e `local_date` a até ±10 dias do `due_date` | `card_payment` (não é gasto, porque as compras já contam no cartão) |
| Conta | `amount < 0` e categoria `Investments`, `Fixed income` ou começando com `Same person transfer` | `transfer` |
| Conta | outros casos com `amount < 0` | `expense` |
| Conta | `amount > 0` e categoria de investimento ou transferência própria | `transfer` |
| Conta | outros casos com `amount > 0` | `income` |

`PENDING` mantém o `kind` normal. O dashboard mostra essas transações separadas,
como "a confirmar".

### Critérios de pronto

- [x] `npm run sync` cria `data/app.db` (permissão 600) e é idempotente: rodar
      duas vezes não muda as contagens.
- [x] Integridade: as 11 faturas dentro da janela batem; as 2 mais antigas ficam `out_of_window`.
- [x] Testes de `classify` e `integrity` com fixtures sintéticas passando.
- [x] `npm run typecheck` sem erros.
- [x] Uma conexão com erro não impede o sync das outras.

## Fase 2: dashboard (concluída em 2026-10-20)

Como usar:
- `npm run dashboard`: faz o build do front e sobe tudo em http://127.0.0.1:8787.
- Desenvolvimento: `npm run api` (porta 8787) + `npm run web:dev` (Vite em 127.0.0.1:5173, com proxy de `/api`).
- `WEB_MOCK=1 npm run web:dev` sobe o front com dados sintéticos, sem API (mock em `web/mock/`, fora do build).

O que existe:

| Arquivo | O que é |
|---|---|
| `src/api/contract.ts` | Contrato HTTP (só tipos), compartilhado entre API e front |
| `src/api/queries.ts`, `src/api/app.ts` | Consultas sobre `v_transactions` e app Hono (`createApp`) |
| `src/config.ts` | `requireEnv` e montagem dos providers, usados por `sync` e `server` |
| `scripts/server.ts` | Servidor em `127.0.0.1` (porta `PORT ?? 8787`) |
| `web/` | Vite + React + Recharts |
| tabela `connection_status` | Último status do fornecedor, `consent_expires_at`, gravado a cada sync |

Segurança: bind só em 127.0.0.1; Host diferente de `127.0.0.1:*`/`localhost:*` → 403 (DNS rebinding);
PATCH/POST exigem `Content-Type: application/json` e Origin local (CSRF); sem CORS; erro 500 genérico.

Decisões:
- Gasto = Σ expense − Σ refund, sem `ignored` e sem PENDING. Mês pelo `local_date`.
- `pendingCount` conta só PENDING de expense/refund (bate com `pendingExpenseCents`).
- O front busca o mês inteiro e filtra no cliente; transfer/card_payment/income ficam ocultos por padrão.
- `byCategory` pode ter valor negativo se a categoria só tiver estornos no mês.

Pendências da fase 2:
- [ ] Revisão visual com os dados reais (só foi validada com mock sintético e por agregados da API).
- [ ] O bundle tem ~630 kB (React + Recharts num chunk só). Aceitável para uso local.
- [ ] `npm run sync` agora abre o banco antes de validar as variáveis; se faltar alguma, pode criar `data/app.db` vazio.

### Especificação original

- API **Hono** ligada **só em `127.0.0.1`** (nunca `0.0.0.0`). Rotas:
  `/api/summary?month=`, `/api/transactions?month=&category=&account=`,
  `/api/categories`, `/api/connections`, e `PATCH /api/overrides/:fingerprint`.
- Front em **Vite + React + Recharts**:
  - gasto do mês;
  - gasto por categoria;
  - evolução mensal (12 meses);
  - lista filtrável com edição de categoria e opção "ignorar";
  - pendentes "a confirmar";
  - painel de saúde das conexões (última atualização, expiração do consentimento).
- Botão "sincronizar agora", que chama o mesmo `SyncService`.

## Fase 3: categorização (concluída em 2026-10-20)

- **Tradução:** `GET /categories` da Pluggy (rota nova no client, só GET; `/categories/rules` da Pluggy é proibido) grava `provider_categories` a cada sync. As 40 categorias presentes nos dados estão traduzidas.
- **Regras locais:** tabela `category_rules`, motor em `src/categorize/rules.ts` (regex com flag `i`, sem acentos dos dois lados, primeira regra habilitada por `priority`). `applyRules` grava `rule_id`/`rule_category` em todas as transações, no fim do sync e após qualquer mudança de regra.
- **Precedência da categoria:** override manual > regra > fornecedor (pt-BR). O `kind` continua vindo da categoria **original** do fornecedor: regra não muda o que conta como gasto.
- **Migrações:** `PRAGMA user_version` + lista `MIGRATIONS` em `src/db/index.ts`; `schema.sql` fica congelado na forma da fase 2; a view está em `src/db/views.sql` e é recriada a cada migração. Backup pré-migração em `data/app.db.bak-fase2` (pode apagar).
- **API:** `GET/POST /api/rules`, `PATCH/DELETE /api/rules/:id`, `POST /api/rules/reorder`, `POST /api/rules/preview`. `TransactionRow` ganhou `categorySource` e `ruleId`.
- **Front:** painel "Regras de categorização" com teste ao vivo, ação "Criar regra…" na lista (padrão sugerido a partir da descrição), badges "manual"/"regra".

Observações:
- O preview da API conta as transações que a regra **de fato** pegaria (respeitando regras anteriores); o mock do front conta casamento bruto. Linhas com override aparecem com "atual → nova" mesmo sem mudar (melhoria possível: `currentSource` na amostra).
- Regex arbitrária roda no servidor, sem proteção contra ReDoS. Aceitável para uso local de um usuário só.
- Ainda não há nenhuma regra cadastrada.

## Fase 4

- **4:** segundo banco (conectar no meu.pluggy.ai, depois **Conectar Conta →
  MeuPluggy** no Dashboard; cada banco gera um `itemId` novo) e `OfxProvider`
  como plano B.

## Pendências

- [x] `.env.example` sem `PLUGGY_API_KEY`. `.env` estava com permissão 664; corrigido para 600.
- [ ] (Opcional) Refazer o consentimento do Inter no meu.pluggy.ai com menos
      categorias de dados. Hoje o item recebeu todos os produtos, inclusive
      IDENTITY, INVESTMENTS e LOANS.
- [ ] Confirmar que o disco está criptografado (LUKS), já que `data/` guarda o
      histórico financeiro.
- [x] Repositório git criado. `.gitignore` exclui `.env` e `data/`. A fase 1 ainda não foi commitada.

## Regras de trabalho para a próxima sessão

- **Nunca ler nem imprimir o `.env`.** Rodar os scripts com `--env-file=.env`.
- Ao analisar `data/raw/` ou `data/app.db`, **imprimir só agregados** (contagens,
  percentuais, somas), nunca descrições ou valores individuais.
- Fixtures de teste devem ser **sintéticas**.
- Na Pluggy, usar só a API de dados, nunca endpoints de pagamento. Qualquer rota
  nova no client entra explicitamente em `ALLOWED_READ_PATHS` e precisa ser GET.
- No Dashboard da Pluggy, o banco **nunca** é conectado pelo conector direto do
  banco (por exemplo, o do Inter com QR Code). O caminho é sempre o MeuPluggy.
- Referência da API: [guia MeuPluggy](https://docs.pluggy.ai/en/docs/guides/meu-pluggy-personal-use.md),
  OpenAPI em `https://api.pluggy.ai/oas3.json` e documentação completa em
  `https://docs.pluggy.ai/llms-full.txt`.
