# openfinance

Dashboard pessoal de gastos que roda só nesta máquina. Lê conta corrente e cartão de crédito
via Open Finance (MeuPluggy + API da Pluggy, **somente leitura**), grava tudo num SQLite local
e mostra os gastos no navegador.

```
npm run sync ─▶ SyncService ─▶ SQLite (data/app.db) ◀─ API Hono ◀─ React (web/)
```

Decisões e riscos estão em [docs/PLANO.md](docs/PLANO.md); o estado de cada fase, em
[docs/PROXIMOS_PASSOS.md](docs/PROXIMOS_PASSOS.md).

## Pré-requisitos

- Node.js **22 ou mais novo** (o projeto roda TypeScript direto com `tsx`, sem build do backend).
- Conta no [meu.pluggy.ai](https://meu.pluggy.ai) (gratuito para uso pessoal, até 5 conexões).
- Conta no [Dashboard da Pluggy](https://dashboard.pluggy.ai) para criar a aplicação.
- Recomendado: disco criptografado, já que `data/` guarda o histórico financeiro.

## 1. Instalar as dependências

```sh
npm install
```

## 2. Conectar os bancos na Pluggy

1. No **meu.pluggy.ai**, conecte cada banco escolhendo sempre a opção **Open Finance**
   (nunca o conector que pede senha ou QR Code do banco).
2. No **Dashboard da Pluggy**, crie uma aplicação em *Applications* e anote o
   `CLIENT_ID` e o `CLIENT_SECRET`.
3. Ainda no Dashboard, use **Connect Account → MeuPluggy** e autorize. Cada banco conectado
   gera um `itemId`; anote todos.

A autorização do MeuPluggy vale **1 ano**. O dashboard avisa 30 dias antes de expirar; para
renovar, repita o *Connect Account* no Dashboard da Pluggy.

## 3. Configurar o `.env`

```sh
cp .env.example .env
chmod 600 .env
```

Preencha:

| Variável | Valor |
|---|---|
| `PLUGGY_CLIENT_ID` | Client ID da aplicação no Dashboard da Pluggy |
| `PLUGGY_CLIENT_SECRET` | Client secret da mesma aplicação |
| `PLUGGY_ITEM_IDS` | `itemId`s do conector MeuPluggy, um por banco, separados por vírgula |
| `PORT` (opcional) | Porta da API; padrão `8787` |

O `.env` está no `.gitignore` e nunca deve ser commitado.

## 4. Sincronizar

```sh
npm run sync
```

Cria `data/app.db` (permissão 600) na primeira vez, aplica as migrações e busca os últimos
365 dias de cada conexão. Imprime só um resumo agregado (contagens, integridade das faturas,
validade do consentimento) e sai com código 1 se alguma conexão falhar. Pode rodar quantas
vezes quiser: as transações da janela são substituídas, e as edições manuais (categoria,
ignorar, fixo/variável) são preservadas.

## 5. Abrir o dashboard

```sh
npm run dashboard
```

Compila o front e sobe a API em <http://127.0.0.1:8787>. O botão de sincronizar no dashboard
chama o mesmo sync do passo anterior. A API só escuta em `127.0.0.1`.

## Desenvolvimento

| Comando | O que faz |
|---|---|
| `npm run api` + `npm run web:dev` | API em 8787 e Vite em <http://127.0.0.1:5173> (com proxy de `/api`) |
| `WEB_MOCK=1 npm run web:dev` | Front com dados sintéticos, sem API nem credenciais |
| `npm test` | Todos os testes (`node:test`) |
| `node --import tsx --test test/rules.test.ts` | Um arquivo de teste |
| `npm run typecheck` | `tsc` do backend e do front |
| `npm run spike` | Salva o JSON bruto da Pluggy em `data/raw/` (diagnóstico) |

## Dados e privacidade

- Tudo fica em `data/` (fora do git): `app.db` e, se usar o `spike`, `data/raw/`.
- O cliente da Pluggy só faz leitura: o único POST é `/auth`, e não há acesso a endpoints de
  pagamento.
- Para revogar o acesso, remova a conexão no meu.pluggy.ai ou no app do banco.

## Problemas comuns

- **`Variável PLUGGY_... não definida`**: o `.env` não existe ou está incompleto (passo 3).
- **Sync volta vazio ou com erro de consentimento**: a autorização expirou; refaça o
  *Connect Account → MeuPluggy* no Dashboard da Pluggy.
- **Dados de ontem não aparecem**: o MeuPluggy atualiza uma vez a cada 24 h (D+1).
