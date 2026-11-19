# BotWhatsApp

Assistente acadêmico para WhatsApp que interpreta mensagens em linguagem natural com a API do **Google Gemini**, extrai dados estruturados de atividades, mantém memória recente de conversa para pedir informações faltantes e persiste as tarefas por usuário no **PostgreSQL**, com API **HTTP Express** local e suíte completa de testes usando o runner nativo `node --test`.

---

## Funcionalidades

- **Cadastro de atividades em linguagem natural:** envie mensagens como *"Prova de Cálculo amanhã valendo 15 pontos"* e o bot extrai título, matéria, tipo (`trabalho`, `prova`, `apresentacao`, `leitura`, `exercicio`, `outro`), data de entrega (`YYYY-MM-DD`), observações e nota.
- **Memória conversacional multi-turno:** se faltarem informações obrigatórias (ex.: matéria ou data), o bot pergunta o que falta e guarda até 6 turnos recentes por usuário (TTL de 15 minutos) para combinar com a resposta seguinte.
- **Numeração sequencial densa (`1..N`) por usuário:** a atividade mais antiga é sempre o ID `1`. Ao apagar uma atividade (ex.: `apagar 1`), as restantes são reorganizadas automaticamente para manter a sequência sem lacunas.
- **Formatação limpa:** exibe `*ID*` e omite automaticamente rótulos de campos não informados (`null`/vazios), preservando `nota: 0`.
- **Fallback automático de modelos Gemini:** usa `gemini-3.1-flash-lite` como padrão e alterna automaticamente para os modelos de fallback configurados em caso de sobrecarga (`503`), falta de cota (`429`) ou modelo indisponível (`404`).
- **Comandos administrativos isolados (`/teste` e `/teste-limpar`):** restritos ao número configurado em `ADMIN_TEST_NUMBER`, executam simulações reais no Gemini salvando apenas em memória (`testTaskStorage`), sem tocar no PostgreSQL de produção.
- **API HTTP local (Express):** expõe `/health`, CRUD completo de `/task` e `POST /message` em `127.0.0.1` com validação rigorosa via Zod.

---

## Comandos do Bot (WhatsApp)

| Comando | Ação |
| :--- | :--- |
| `<mensagem livre>` | Interpreta com o Gemini, pede dados faltantes se necessário e salva no PostgreSQL. |
| `comandos` | Exibe a lista de comandos disponíveis. |
| `todas` | Lista todas as atividades do usuário em **uma única mensagem** consolidada com os IDs. |
| `apagar <id>` | Apaga a atividade correspondente ao ID do usuário e reorganiza os IDs restantes. |
| `/teste` | *(Admin)* Simula 2 mensagens reais no Gemini usando storage isolado em memória. |
| `/teste-limpar` | *(Admin)* Limpa o storage isolado de testes. |

---

## Arquitetura e Tecnologias

### Stack
- **Runtime:** Node.js (ESM nativo — `"type": "module"`)
- **WhatsApp:** `whatsapp-web.js` + `qrcode-terminal`
- **IA:** `@google/genai` (Structured Outputs via JSON Schema)
- **Banco de Dados:** PostgreSQL (`pg` com pool de conexões e queries 100% parametrizadas)
- **HTTP & Validação:** `express` v5 + `zod` v4 + `dotenv`
- **Testes:** Runner nativo `node --test` + `node:assert/strict`

### Estrutura de Pastas

```text
src/
├── app.js                               # Orquestração de boot (DB -> HTTP -> WhatsApp) e graceful shutdown
├── config/
│   ├── env.js                           # Carregamento lazy e validação Zod das variáveis de ambiente
│   └── .env                             # Variáveis locais (não versionado)
├── Controller/
│   └── Controller.js                    # Roteamento de comandos, memória, /teste e criação/exclusão de tarefas
├── Service/
│   └── Service.js                       # Montagem de prompt (horário local + histórico) e fallback de modelos Gemini
├── Model/
│   └── Task.js                          # Modelo Task com compatibilidade posicional e toPersistenceData()
├── Repository/
│   ├── Task_Db_Repository.js            # CRUD PostgreSQL parametrizado, contagem e numeração densa (1..N)
│   ├── Task_Repository.js               # Schemas Zod/JSON Schema + repositório em memória (testTaskStorage)
│   ├── Messages_Repository.js           # Formatação de mensagens, datas e memória conversacional (TTL + FIFO)
│   └── TIme_Repository.js               # Placeholder de horários futuros
├── Server/
│   ├── PgConnect.js                     # Pool PostgreSQL e inicialização idempotente do schema e índices
│   └── Server.js                        # Servidor HTTP Express (/health, /task, /message)
└── Integrations/
    ├── gemini/client.js                 # Cliente lazy do GoogleGenAI
    └── whatsapp/client.js               # Inicialização desacoplada do cliente WhatsApp Web
test/
├── unit/                                # Testes unitários rápidos e offline (sem rede/DB)
└── integration/                         # Testes reais contra PostgreSQL, API do Gemini e Express HTTP
```

### Fluxo Principal

1. O entrypoint [src/app.js](src/app.js) inicializa o schema no PostgreSQL (`PgConnect.js`), sobe o servidor HTTP (`Server.js`) e inicia o cliente WhatsApp (`Integrations/whatsapp/client.js`), com rollback em caso de falha no startup.
2. Mensagens recebidas (via WhatsApp ou `POST /message`) passam pelo `Controller.js`, que trata comandos diretos (`comandos`, `todas`, `apagar <id>`, `/teste`, `/teste-limpar`) ou encaminha o texto + histórico recente para o `Service.js`.
3. O `Service.js` envia o prompt com horário local e schema JSON para o Gemini e valida a resposta com Zod (`aiTaskResponseSchema`).
4. Se `sucesso === true`, a tarefa é salva no PostgreSQL (`Task_Db_Repository.js`) e a memória do usuário é limpa; se `sucesso === false`, o turno é salvo na `conversationMemory` e o bot pergunta o que faltou.

---

## Pré-requisitos, Configuração e Instalação

### Pré-requisitos
- **Node.js** `20+` (desenvolvido e validado em Node.js `v24.22.0`)
- **PostgreSQL** em execução com um banco criado (ex.: `botwhatsapp`)
- **Chave da API do Google Gemini** (`GEMINI_API_KEY`)
- **Google Chrome** instalado (para execução do `whatsapp-web.js` via Puppeteer)

### Instalação

```bash
npm install
```

### Configuração do `.env`

Crie o arquivo `src/config/.env` (ignorado pelo Git) com as seguintes variáveis:

```env
# Obrigatórias
GEMINI_API_KEY="sua-chave-gemini"
DB_HOST="localhost"
DB_PORT="5432"
DB_USER="postgres"
DB_PASSWORD="sua-senha-postgres"
DB_NAME="botwhatsapp"

# Opcionais
HTTP_PORT="3000"
GEMINI_MODEL="gemini-3.1-flash-lite"
GEMINI_FALLBACK_MODELS="gemini-2.5-flash-lite,gemini-2.5-flash,gemini-2.0-flash"
CHROME_EXECUTABLE_PATH=""
ADMIN_TEST_NUMBER="5531999998888"
```

---

## Execução

### Iniciar o bot + servidor HTTP

```bash
npm start
```

- Na primeira execução, um **QR Code** será exibido no terminal para autenticar o WhatsApp Web (a sessão fica salva localmente em `.wwebjs_auth/`).
- O servidor HTTP local ficará disponível em `http://127.0.0.1:3000` (ou na porta definida em `HTTP_PORT`).

### Endpoints HTTP Locais

| Método & Rota | Descrição |
| :--- | :--- |
| `GET /health` | Verifica conexão real com o PostgreSQL (`200 ok` ou `503 error`). |
| `GET /task` | Lista tarefas (filtro opcional `?whatsapp_id=...` ou `?user=...`). |
| `GET /task/:id` | Busca uma tarefa por ID global (filtro opcional por usuário). |
| `POST /task` | Cria uma tarefa validada com Zod (`201 Created`). |
| `PATCH /task/:id` | Atualiza campos de uma tarefa existente. |
| `DELETE /task/:id` | Remove uma tarefa por ID global. |
| `POST /message` | Executa o mesmo fluxo de mensagens do bot via HTTP (`{ "from": "...", "body": "..." }`). |

---

## Testes (`node --test`)

Os testes utilizam exclusivamente o runner nativo do Node.js:

```bash
# Testes unitários rápidos (offline, sem depender de PostgreSQL ou Gemini)
npm run test:unit

# Apenas testes de integração reais (PostgreSQL + API do Gemini + Express HTTP)
npm run test:integration

# Suíte completa (unitários + integração reais)
npm test
```

> Os testes de integração usam o banco configurado em `src/config/.env` com `whatsapp_id` exclusivo por execução e removem automaticamente apenas os registros criados durante os testes no `after()`.
