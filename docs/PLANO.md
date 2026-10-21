# Plano: dashboard pessoal de gastos via Open Finance

App local (roda só nesta máquina) que lê conta corrente e cartão de crédito
dos meus bancos e mostra os gastos num dashboard no navegador.
Começa por um banco (PF) e foi pensado para N bancos.

## Decisões

| Tema | Decisão | Motivo |
|---|---|---|
| Fonte de dados | **MeuPluggy + conector MeuPluggy** na API da Pluggy | Pessoa física não pode acessar o Open Finance diretamente, e as APIs próprias dos bancos costumam ser só para PJ. O MeuPluggy é gratuito para uso pessoal (até 5 conexões) e não expira com o trial. |
| Plano B | Importação de OFX/CSV | Não depende de terceiros |
| Permissões | Só leitura | O consentimento de dados do Open Finance não movimenta dinheiro. O `PluggyClient` só faz GET em rotas permitidas; o único POST é `/auth`. |
| Linguagem | TypeScript (Node 22, `tsx`) | Preferência pessoal |
| Banco local | SQLite (`better-sqlite3`) | Arquivo local, sem servidor |
| Dashboard | API Hono em `127.0.0.1` + Vite/React + Recharts | Sem exposição na rede |
| Paginação | `GET /v2/transactions` (cursor) | O `/transactions` paginado deixa de existir em 31/12/2026 |

## Arquitetura

```
CLI `sync` ──▶ SyncService ──▶ SQLite ◀── API local (Hono) ◀── Dashboard (React)
                  │
        interface DataProvider
        ├── PluggyProvider  (1 item MeuPluggy = 1 banco)
        └── OfxProvider     (plano B)
```

- **N bancos:** a tabela `connections (id, provider, external_id, nickname)`
  guarda as conexões. Para adicionar um banco: conectar no meu.pluggy.ai,
  autorizar no Dashboard e cadastrar o `itemId`.
- **Dedupe (validado na fase 0):** pelo conector MeuPluggy, `providerId` e
  `providerCode` vêm **sempre vazios**. O `id` da Pluggy **muda** em transações
  de cartão perto do fechamento da fatura. Por isso:
  - o sync **substitui** as transações de cada conta dentro da janela buscada
    (apaga e reinsere), em vez de fazer upsert por id;
  - linhas mais antigas que a janela de 12 meses ficam guardadas como histórico;
  - edições manuais (categoria, "ignorar") ficam numa tabela à parte, com chave
    `date + amount + description + order`. Nos dados reais essa chave foi
    única em 100% dos casos.

## Regras de "gasto" (evitar contar duas vezes)

O sinal do `amount` é **oposto** entre os tipos de conta (validado na fase 0).
Por isso, normalizar para `direction` + valor absoluto no momento do sync.

- **Cartão:** `DEBIT` com `amount > 0` é compra e entra como gasto.
  `CREDIT` com `amount < 0` é pagamento da fatura (não entra) ou estorno
  (abate do gasto). Para distinguir: o pagamento tem o valor igual ao
  `totalAmount` da fatura anterior.
- **Conta corrente:** `DEBIT` com `amount < 0` entra como gasto, **exceto**:
  - pagamento da fatura do cartão, identificado por débito com o mesmo valor do
    `totalAmount` de uma fatura, perto do `dueDate` (as compras já foram contadas
    no cartão);
  - categorias `Investments`, `Fixed income` e `Same person transfer*`, que são
    aplicações e transferências entre contas próprias.
- **Conferência:** a soma das compras de cada `billId` bate exatamente com o
  `totalAmount` da fatura. Usar isso como teste de integridade do sync.
- Lançamentos `PENDING` aparecem separados ("a confirmar").
- Datas chegam em UTC; o dia e o mês de referência são calculados em America/Sao_Paulo.

## Fases

0. **Teste de viabilidade** (`npm run spike`): confirmar que os dados do banco
   chegam completos e guardar o JSON bruto em `data/raw/`.
1. **Sync + SQLite:** schema, `DataProvider`, comando `sync`, dedupe.
2. **Dashboard:** gasto por mês e por categoria, lista filtrável, saúde das conexões.
3. **Categorização:** regras locais por regex sobre a descrição, partindo
   da categoria da Pluggy.
4. **Mais bancos e OFX.**

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Vazamento do `client_secret`, que dá leitura de todo o histórico | `.env` com `chmod 600`, fora do git (depois migrar para o keyring). Nunca logar. Gerar outro se vazar. |
| Conectar um banco por conector que pede senha | No meu.pluggy.ai, escolher sempre a opção **Open Finance** do banco. O item do Dashboard é do conector MeuPluggy, então a checagem `isOpenFinance` não vale para ele. |
| Cópia dos dados na Pluggy | Empresa regulada pelo BC. Revogar no app do banco ou no MeuPluggy quando não usar mais. |
| Autorização do MeuPluggy expira em 1 ano e as leituras voltam vazias | O dashboard mostra `consentExpiresAt` e alerta 30 dias antes. Para renovar, repetir o "Connect Account" no Dashboard. |
| SQLite e `data/raw/` com o histórico financeiro | Disco criptografado (LUKS), arquivos com permissão 600, `data/` no `.gitignore` |
| Dashboard exposto | Bind apenas em `127.0.0.1` |
| Free tier mudar | Plano B com OFX. A interface `DataProvider` permite trocar de fornecedor. |
| Dados D+1 (MeuPluggy atualiza a cada 24h) | Aceitável para controle de gastos |
