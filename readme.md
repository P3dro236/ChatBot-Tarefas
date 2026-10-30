# BotWhatsApp --- Documentação do Projeto

> **Status do documento:** visão consolidada do que já existe e do que
> está planejado.\
> **Importante:** funcionalidades descritas como planejadas ainda não
> devem ser consideradas implementadas.

## 1. Resumo do funcionamento

O BotWhatsApp tem como objetivo permitir que o usuário registre
atividades acadêmicas por mensagens no WhatsApp. O bot interpreta a
mensagem com ajuda do Gemini, extrai os dados relevantes e, futuramente,
salva a atividade em um banco de dados para consulta, edição e
lembretes.

### Fluxo pretendido

1.  O usuário envia uma mensagem pelo WhatsApp, por exemplo:\
    `Tenho prova de Cálculo no dia 30/10, valendo 10 pontos.`
2.  O cliente do WhatsApp recebe a mensagem.
3.  A integração com o Gemini transforma o texto em dados estruturados
    em JSON.
4.  O backend valida a resposta da IA e verifica se há informações
    obrigatórias faltando.
5.  Se faltarem dados necessários, o bot pergunta ao usuário e mantém o
    contexto da atividade pendente.
6.  Quando os dados estiverem completos, a atividade é cadastrada no
    banco de dados.
7.  O bot confirma o registro e poderá oferecer consultas, alterações,
    exclusões e lembretes.

### Arquitetura resumida

``` text
Usuário
  │
  ▼
WhatsApp
  │
  ▼
Cliente WhatsApp (whatsapp-web.js)
  │
  ▼
Controlador / tratamento da mensagem
  │
  ▼
Serviço de interpretação (Gemini)
  │
  ▼
Validação dos dados
  │
  ├── Dados faltando ──► salvar estado da conversa e perguntar ao usuário
  │
  ▼
Serviço de atividades
  │
  ▼
PostgreSQL (planejado)
  │
  ▼
Resposta pelo WhatsApp
```

O Express será usado para disponibilizar endpoints HTTP para testar e
expor operações da aplicação. O cliente do WhatsApp pode chamar
diretamente os serviços internos quando ambos estiverem no mesmo
backend; não é obrigatório fazer uma requisição HTTP interna para cada
mensagem.

------------------------------------------------------------------------

## 2. Tecnologias utilizadas ou previstas

  -----------------------------------------------------------------------
  Tecnologia              Situação                Responsabilidade
  ----------------------- ----------------------- -----------------------
  JavaScript com módulos  Em uso                  Linguagem e organização
  ES (`import`/`export`)                          dos módulos

  Node.js                 Em uso                  Executar o backend

  `whatsapp-web.js`       Em uso                  Conectar ao WhatsApp
                                                  Web e receber/enviar
                                                  mensagens

  `qrcode-terminal`       Usado no fluxo inicial  Exibir o QR code de
                          de conexão              autenticação no
                                                  terminal

  `@google/genai`         Em uso                  Chamar a API do Gemini

  Gemini                  Usado no código de      Interpretar mensagens e
  `gemini-2.5-flash`      extração                produzir JSON
                                                  estruturado

  `dotenv`                Em uso                  Carregar variáveis de
                                                  ambiente de
                                                  `config/.env`

  Express                 Em aprendizado /        Criar rotas HTTP e uma
                          implementação inicial   API

  PostgreSQL              Planejado               Persistir usuários,
                                                  atividades e estado de
                                                  conversas

  Zod ou validação        Planejado/recomendado   Validar a estrutura e
  equivalente                                     os valores recebidos
                                                  antes de salvar

  Prisma                  Considerado como opção  Facilitar o acesso ao
                                                  PostgreSQL, caso
                                                  escolhido

  Docker / VPS ou         Ideias futuras          Empacotar e manter os
  hospedagem                                      serviços em execução
  -----------------------------------------------------------------------

A escolha entre SQL direto e Prisma ainda deve ser definida antes da
implementação do acesso ao banco.

------------------------------------------------------------------------

## 3. Funcionalidades já existentes

### 3.1 Recepção de mensagens pelo WhatsApp

O projeto usa `whatsapp-web.js` para receber mensagens pelo WhatsApp
Web. O fluxo inicial também inclui autenticação por QR code e sessão
local.

Há um tratamento inicial de mensagens no cliente do WhatsApp. Foi
utilizado um comando de teste `!ping`, que responde `pong`, para
verificar a comunicação.

**Limitação atual:** a recepção de mensagens ainda precisa ser integrada
ao fluxo completo de cadastro e persistência das atividades.

### 3.2 Integração com o Gemini

O projeto já chama o Gemini usando o pacote `@google/genai`. A função de
extração recebe o texto de uma mensagem e solicita uma resposta em JSON,
usando `responseMimeType: "application/json"` e um schema de resposta.

A integração com a chave de API usa `dotenv`, com o arquivo
`config/.env` e um módulo central de configuração `config/env.js`. A
chave não deve ser colocada diretamente no código nem enviada ao
repositório.

### 3.3 Extração estruturada de atividade

O schema atual define os seguintes campos:

  -----------------------------------------------------------------------
  Campo                   Tipo previsto           Significado
  ----------------------- ----------------------- -----------------------
  `titulo`                `string`                Nome conciso da
                                                  atividade

  `materia`               `string` ou `null`      Disciplina associada

  `tipo`                  `string` de uma lista   Categoria da atividade
                          permitida               

  `data_entrega`          `string` no formato     Data de entrega ou
                          `YYYY-MM-DD` ou `null`  realização

  `observacoes`           `string` ou `null`      Detalhes extras
                                                  relevantes

  `nota`                  `number` ou `null`      Valor/nota declarada
                                                  para a atividade
  -----------------------------------------------------------------------

Valores permitidos para `tipo`:

-   `trabalho`
-   `prova`
-   `apresentacao`
-   `leitura`
-   `exercicio`
-   `outro`

No schema atual, `titulo`, `materia`, `tipo` e `data_entrega` estão na
lista `required`. `materia` e `data_entrega` permitem `null`, portanto
"obrigatório no formato" não significa que a informação sempre foi
fornecida pelo usuário. A lógica da aplicação deverá decidir quando um
`null` exige uma pergunta de esclarecimento.

A função de extração faz o parse da resposta para obter um objeto
JavaScript. A resposta deve ser validada antes de ser usada para criar
ou alterar registros.

### 3.4 Teste manual de prompt injection

Foi preparado um teste com uma mensagem que tenta instruir o modelo a
ignorar o schema, adicionar campos como `admin` e `api_key`, usar um
tipo inválido e alterar a data.

O objetivo é avaliar se a saída permanece dentro do formato esperado.
Esse teste é apenas uma verificação inicial: **schema estruturado não
substitui validação no backend**. A aplicação nunca deve tratar a saída
da IA como confiável sem verificar campos, tipos, valores e permissões.

### 3.5 Configuração de ambiente

A configuração da chave do Gemini está centralizada em `config/.env` e
`config/env.js`. A aplicação deve falhar com uma mensagem clara se a
variável obrigatória não estiver configurada.

Cuidados: - manter `.env` fora do controle de versão; - disponibilizar
um `.env.example` sem segredos; - revogar e substituir chaves que tenham
sido expostas; - não enviar segredos reais ao modelo como parte de uma
mensagem de usuário.

------------------------------------------------------------------------

## 4. Funcionalidades em desenvolvimento

### 4.1 API com Express

O objetivo é criar endpoints para testar e operar atividades de forma
independente do WhatsApp.

Rotas previstas:

  Método     Endpoint                Objetivo
  ---------- ----------------------- ------------------------------------
  `GET`      `/api/atividades`       Listar atividades
  `GET`      `/api/atividades/:id`   Consultar uma atividade
  `POST`     `/api/atividades`       Cadastrar uma atividade
  `PATCH`    `/api/atividades/:id`   Alterar parcialmente uma atividade
  `DELETE`   `/api/atividades/:id`   Excluir uma atividade

A primeira prática de Express é criar `GET /api/atividades` e retornar
`[]` em JSON. O usuário está aprendendo a escrever as rotas por conta
própria, então a implementação deve ser desenvolvida em etapas, não
substituída por código completo sem explicação.

A estrutura de arquivos considerada é:

``` text
src/
  app.js
  server.js
  routes/
    atividades.routes.js
```

Responsabilidades esperadas: - `app.js`: criar e configurar o Express,
registrar middleware e rotas; - `server.js`: iniciar o servidor HTTP; -
`atividades.routes.js`: declarar os endpoints de atividades.

No começo, as rotas podem ser testadas com dados temporários em memória.
Esses dados desaparecem ao reiniciar o processo; essa etapa é apenas
para aprender e testar o contrato da API, não é persistência definitiva.

### 4.2 Validação dos dados

Antes de salvar uma atividade, o backend deve verificar, no mínimo:

-   se o título é uma string válida e não está vazio;
-   se `tipo` pertence ao conjunto permitido;
-   se `data_entrega` é uma data real no formato esperado;
-   se `nota` é um número finito ou `null`;
-   se os campos opcionais têm tipos permitidos;
-   se a requisição não tenta incluir campos inesperados;
-   se o usuário tem permissão para acessar ou alterar o registro.

A validação deve ocorrer no backend mesmo que o Gemini use um schema.
Também é importante distinguir uma informação ausente de uma informação
inválida.

------------------------------------------------------------------------

## 5. Funcionalidades planejadas

### 5.1 Perguntar por informações faltantes

Se a mensagem não informar uma data, o bot deverá perguntar, por
exemplo:

> Qual é a data de entrega dessa atividade?

A aplicação precisa guardar a atividade incompleta e o campo que está
aguardando resposta. Quando o usuário responder, o sistema deverá
interpretar a resposta no contexto da pergunta pendente e completar a
atividade anterior, em vez de criar outra atividade por engano.

Pontos que precisam ser implementados: 1. detectar quais dados precisam
ser esclarecidos; 2. guardar a atividade pendente por usuário; 3.
guardar qual campo está aguardando resposta; 4. interpretar a próxima
mensagem como resposta, quando apropriado; 5. atualizar a atividade
pendente; 6. confirmar o registro quando os dados necessários estiverem
completos; 7. tratar respostas ambíguas, cancelamento e mensagens que
iniciam uma nova atividade.

O estado da conversa precisa ser persistente no futuro, para não se
perder quando o processo reiniciar.

### 5.2 Cadastro e gerenciamento de atividades

Depois de validar e completar os dados, o bot deverá permitir:

-   criar uma atividade;
-   listar atividades do usuário;
-   consultar uma atividade específica;
-   editar título, disciplina, tipo, data, observações ou nota;
-   excluir uma atividade;
-   consultar atividades próximas do prazo;
-   filtrar atividades por disciplina, categoria ou período.

As operações devem sempre respeitar o usuário proprietário da atividade.

### 5.3 PostgreSQL

O PostgreSQL será usado para manter os dados após reinicializações. Uma
proposta inicial é ter três tabelas.

#### `usuarios`

Armazena a identidade do usuário no sistema.

Campos candidatos: - `id`: chave primária; - `whatsapp_id`:
identificador do remetente no WhatsApp, único; - `nome`: nome, se
disponível; - `created_at`: data de criação do registro.

#### `atividades`

Armazena as atividades acadêmicas.

Campos candidatos: - `id`: chave primária; - `usuario_id`: chave
estrangeira para `usuarios`; - `titulo`: obrigatório; - `materia`:
opcional; - `tipo`: categoria validada; - `data_entrega`: opcional; -
`observacoes`: opcional; - `nota`: valor numérico opcional; -
`created_at`: data de criação.

Um índice por usuário e data de entrega pode ajudar consultas de
atividades futuras.

#### `conversas`

Mantém o estado necessário para continuar interações incompletas.

Campos candidatos: - `id`: chave primária; - `usuario_id`: chave
estrangeira e possivelmente única se houver apenas uma conversa ativa
por usuário; - `estado`: por exemplo, `ociosa` ou
`aguardando_resposta`; - `atividade_pendente`: dados provisórios da
atividade, possivelmente em `JSONB`; - `campo_pendente`: informação que
o bot precisa perguntar; - `updated_at`: última atualização.

Esse desenho é uma proposta inicial, não um esquema já criado. O modelo
final deve acompanhar as regras de negócio que forem implementadas.

### 5.4 Lembretes

Objetivo: avisar o usuário sobre atividades que estão próximas do prazo.

Possíveis recursos: - lembretes em horários configuráveis; - aviso no
dia anterior; - aviso no dia da entrega; - evitar enviar o mesmo
lembrete repetidamente; - respeitar atividades editadas ou excluídas.

Para implementar isso, será necessário definir como os agendamentos
serão executados e como o sistema registra os lembretes já enviados. Um
processo em execução contínua ou um agendador persistente será
importante em hospedagem.

### 5.5 Segurança e controle de acesso

Itens planejados ou recomendados: - permitir processamento apenas de
números autorizados, pelo menos durante o desenvolvimento; - validar o
identificador do remetente antes de executar ações; - validar toda saída
do Gemini; - não permitir que campos inesperados alterem dados
internos; - não expor chaves, prompts internos ou informações de outros
usuários; - tratar erros sem revelar segredos; - usar consultas
parametrizadas ou uma camada ORM segura; - validar a propriedade de cada
atividade antes de editar ou excluir; - proteger as rotas Express se
forem expostas fora da máquina local.

### 5.6 Organização em módulos

A organização proposta separa integrações externas, regras de negócio,
rotas e persistência.

``` text
src/
  integrations/
    whatsapp/
      client.js
    gemini/
      client.js
      gemini.service.js
      schemas/
        atividade.schema.js
  routes/
    atividades.routes.js
  modules/
    atividade/
      atividade.service.js
      atividade.model.js
    conversa/
      conversa.service.js
      conversa.model.js
  app.js
  server.js
config/
  .env
  env.js
```

Essa árvore é uma direção de arquitetura, não uma declaração de que
todos esses arquivos já existem.

Responsabilidades: - **integração WhatsApp:** receber mensagens e enviar
respostas; - **integração Gemini:** chamar a IA e extrair dados
estruturados; - **rotas/controller:** receber requisições HTTP e
coordenar respostas; - **serviços:** aplicar regras de negócio, validar
fluxos e decidir operações; - **modelos/repositórios:** acessar o banco
de dados; - **configuração:** carregar variáveis de ambiente e opções de
execução.

------------------------------------------------------------------------

## 6. Decisões de arquitetura importantes

### O Express é obrigatório para o bot?

Não. Se o cliente do WhatsApp e os serviços estiverem no mesmo processo
Node.js, o cliente pode chamar diretamente as funções de serviço. O
Express é útil para disponibilizar uma API HTTP, permitir que um
frontend ou outro sistema acesse os dados e testar as operações
separadamente.

### O Gemini deve gravar diretamente no banco?

Não. O Gemini deve interpretar a mensagem e sugerir dados estruturados.
O backend deve validar a saída e executar as operações autorizadas. A IA
não deve receber acesso direto às credenciais do banco nem decidir
permissões.

### O que acontece se a IA retornar JSON válido, mas com dados errados?

O formato válido não garante a interpretação correta. A aplicação deve
validar valores e, quando necessário, pedir confirmação ao usuário ---
especialmente para datas relativas, ambiguidades ou dados incompletos.

### Como lidar com datas relativas?

A data deve ser calculada usando a data atual e o fuso horário relevante
para o usuário. A aplicação deve validar o resultado e pedir
esclarecimento quando a expressão for ambígua. O formato interno
planejado é `YYYY-MM-DD`.

------------------------------------------------------------------------

## 7. Sequência de implementação sugerida

1.  **Aprender o Express:** criar a aplicação e fazer
    `GET /api/atividades` retornar `[]`.
2.  **Entender requisições e respostas:** usar `req.params`,
    `req.query`, `req.body`, `res.status()` e `res.json()`.
3.  **Implementar `POST`:** receber uma atividade e validar os campos
    essenciais.
4.  **Testar `GET` e `POST` com armazenamento temporário:** entender o
    contrato da API sem depender do banco.
5.  **Separar rotas e serviços:** não concentrar todas as regras dentro
    dos handlers Express.
6.  **Implementar validação de schema:** validar os dados do Gemini e os
    dados recebidos pelas rotas.
7.  **Desenhar o banco definitivo:** criar tabelas e relações a partir
    das necessidades confirmadas.
8.  **Conectar PostgreSQL:** substituir armazenamento temporário por
    persistência real.
9.  **Implementar o estado de conversa:** perguntar por dados faltantes
    e completar atividades pendentes.
10. **Integrar o fluxo completo com WhatsApp:** receber, interpretar,
    validar, salvar e responder.
11. **Adicionar operações de edição, exclusão e consulta.**
12. **Adicionar lembretes e controles de segurança.**
13. **Preparar implantação:** configurar variáveis de ambiente, processo
    persistente, logs, recuperação de sessão e backups.

------------------------------------------------------------------------

## 8. Estado atual em uma frase

O projeto já possui uma base de recepção de mensagens pelo WhatsApp,
integração com o Gemini para extrair dados estruturados de atividades e
configuração de ambiente; a próxima etapa é aprender Express e
definir/testar a API, antes de implementar a persistência PostgreSQL e o
gerenciamento de conversas incompletas.

## 9. Checklist de acompanhamento

-   [x] Receber mensagens pelo WhatsApp usando `whatsapp-web.js`.
-   [x] Ter um comando simples de teste de comunicação (`!ping`).
-   [x] Conectar ao Gemini pela biblioteca `@google/genai`.
-   [x] Solicitar JSON estruturado usando schema.
-   [x] Configurar a chave do Gemini por variável de ambiente.
-   [x] Preparar teste manual de resistência a prompt injection.
-   [ ] Criar e testar `GET /api/atividades` com Express.
-   [ ] Criar e testar `POST /api/atividades`.
-   [ ] Definir validação completa dos dados.
-   [ ] Separar rotas, serviços e acesso a dados.
-   [ ] Criar banco PostgreSQL e tabelas.
-   [ ] Persistir atividades e usuários.
-   [ ] Guardar o estado de conversas pendentes.
-   [ ] Perguntar por dados faltantes e retomar a atividade.
-   [ ] Implementar consulta, edição e exclusão.
-   [ ] Implementar lembretes.
-   [ ] Reforçar autorização, tratamento de erros e segurança.
-   [ ] Implantar em ambiente que mantenha o bot em execução.

> Este documento deve ser atualizado à medida que as funcionalidades
> forem implementadas. A lista distingue a base já existente das
> funcionalidades planejadas, mas o estado exato dos arquivos deve ser
> confirmado no repositório antes de considerar qualquer item concluído.
