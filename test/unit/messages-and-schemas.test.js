import { after, describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    commands,
    createConversationMemory,
    EMPTY_TASKS_MESSAGE,
    formatTaskDeletedMessage,
    formatTaskNotFoundMessage,
    formatTasksListMessage,
    readable_date,
    sucess_task_msg,
} from "../../src/Repository/Messages_Repository.js";
import {
    TASK_TYPES,
    atividade_schema,
    aiTaskResponseSchema,
    createInMemoryTaskRepository,
    createTaskBodySchema,
    updateTaskBodySchema,
    isValidCalendarDate,
    testTaskStorage,
} from "../../src/Repository/Task_Repository.js";
import { Task } from "../../src/Model/Task.js";
import { loadEnv } from "../../src/config/env.js";

describe("Messages_Repository", () => {
    it("preserva o texto exato da constante commands", () => {
        const expected = `Lista de comandos:

*Todas*: Mostra todas as atividades ainda não concluidas.

*Apagar*: Apaga uma atividade com base no número de ID.`;

        assert.equal(commands, expected);
    });

    describe("readable_date", () => {
        it("formata string YYYY-MM-DD em DD/MM", () => {
            assert.equal(readable_date("2026-11-25"), "25/11");
            assert.equal(readable_date("2026-01-05"), "05/01");
        });

        it("formata string ISO completa em DD/MM", () => {
            assert.equal(readable_date("2026-03-09T18:45:00.000Z"), "09/03");
        });

        it("formata instância Date usando componentes UTC", () => {
            const utcDate = new Date(Date.UTC(2026, 11, 1, 0, 0, 0));
            assert.equal(readable_date(utcDate), "01/12");
        });

        it("retorna 'Não informada' para null, undefined, vazio, datas inexistentes ou formatos inválidos", () => {
            assert.equal(readable_date(null), "Não informada");
            assert.equal(readable_date(undefined), "Não informada");
            assert.equal(readable_date(""), "Não informada");
            assert.equal(readable_date("   "), "Não informada");
            assert.equal(readable_date("25/11/2026"), "Não informada");
            assert.equal(readable_date("2026-02-31"), "Não informada");
            assert.equal(readable_date("2026-02-29"), "Não informada");
            assert.equal(readable_date(new Date("invalid")), "Não informada");
            assert.equal(readable_date(12345), "Não informada");
        });
    });

    describe("sucess_task_msg", () => {
        it("formata mensagem completa com ID, todos os campos informados e observações", () => {
            const msgWithUserTaskId = sucess_task_msg({
                id: 99,
                user_task_id: 1,
                titulo: "Prova de Cálculo",
                materia: "Matemática",
                nota: 15,
                data_entrega: "2026-11-25",
                observacoes: "Capítulos 1 a 3",
            });

            assert.equal(
                msgWithUserTaskId,
                `*ID*: 1
*Titulo*: Prova de Cálculo
*Materia*: Matemática
*Nota*: 15
*Data* de entrega: 25/11
*Observacoes*: Capítulos 1 a 3`
            );

            const msgWithIdOnly = sucess_task_msg({
                id: 2,
                titulo: "Seminário",
                materia: "Redes",
                nota: 10,
                data_entrega: "2026-12-01",
            });

            assert.equal(
                msgWithIdOnly,
                `*ID*: 2
*Titulo*: Seminário
*Materia*: Redes
*Nota*: 10
*Data* de entrega: 01/12`
            );
        });

        it("preserva nota igual a 0 sem omitir o campo", () => {
            const msg = sucess_task_msg({
                user_task_id: 3,
                titulo: "Lista de Exercícios",
                materia: "Física",
                nota: 0,
                data_entrega: "2026-06-10",
            });

            assert.match(msg, /\*ID\*: 3/);
            assert.match(msg, /\*Nota\*: 0/);
        });

        it("omite campos vazios, nulos ou inválidos em vez de exibir 'Não informada'", () => {
            const partialMsg = sucess_task_msg({
                user_task_id: 4,
                titulo: "Trabalho de História",
                materia: "   ",
                nota: null,
                data_entrega: "2026-02-31",
                observacoes: null,
            });

            assert.equal(
                partialMsg,
                `*ID*: 4
*Titulo*: Trabalho de História`
            );
            assert.equal(partialMsg.includes("*Materia*:"), false);
            assert.equal(partialMsg.includes("*Nota*:"), false);
            assert.equal(partialMsg.includes("*Data* de entrega:"), false);
            assert.equal(partialMsg.includes("*Observacoes*:"), false);
            assert.equal(partialMsg.includes("Não informada"), false);

            const allEmptyMsg = sucess_task_msg({
                titulo: "  ",
                materia: null,
                nota: undefined,
                data_entrega: null,
                observacoes: "",
            });

            assert.equal(allEmptyMsg, "");
        });
    });

    describe("formatTasksListMessage e mensagens auxiliares", () => {
        it("retorna EMPTY_TASKS_MESSAGE quando a lista está vazia ou sem itens formatáveis", () => {
            assert.equal(formatTasksListMessage([]), EMPTY_TASKS_MESSAGE);
            assert.equal(formatTasksListMessage(null), EMPTY_TASKS_MESSAGE);
            assert.equal(formatTasksListMessage([{}]), EMPTY_TASKS_MESSAGE);
        });

        it("consolida múltiplas tarefas em uma única string com todos os IDs e omissão de campos vazios", () => {
            const message = formatTasksListMessage([
                {
                    user_task_id: 1,
                    titulo: "Prova 1",
                    materia: "Cálculo",
                    nota: null,
                    data_entrega: "2026-11-25",
                    observacoes: "   ",
                },
                {
                    user_task_id: 2,
                    titulo: "Trabalho Final",
                    materia: null,
                    nota: 0,
                    data_entrega: null,
                    observacoes: "Em dupla",
                },
            ]);

            assert.equal(typeof message, "string");
            assert.equal(
                message,
                `Suas atividades:

*ID*: 1
*Titulo*: Prova 1
*Materia*: Cálculo
*Data* de entrega: 25/11

──────────

*ID*: 2
*Titulo*: Trabalho Final
*Nota*: 0
*Observacoes*: Em dupla`
            );
        });

        it("formata mensagens de exclusão (com e sem aviso de reorganização) e ID não encontrado", () => {
            assert.equal(
                formatTaskDeletedMessage(3, 0),
                "Atividade #3 apagada com sucesso! 🗑️"
            );
            assert.equal(
                formatTaskDeletedMessage(3, 2),
                "Atividade #3 apagada com sucesso! 🗑️\nOs IDs restantes foram reorganizados — digite *todas* para conferir."
            );
            assert.equal(
                formatTaskDeletedMessage(3),
                "Atividade #3 apagada com sucesso! 🗑️\nOs IDs restantes foram reorganizados — digite *todas* para conferir."
            );
            assert.equal(
                formatTaskNotFoundMessage(7),
                "Não encontrei nenhuma atividade com o ID 7."
            );
        });
    });

    describe("createConversationMemory", () => {
        it("adiciona turnos user/assistant, ignora entradas inválidas e preserva cópias isoladas", () => {
            const memory = createConversationMemory({
                maxMessagesPerUser: 6,
                ttlMs: 60_000,
                maxUsers: 10,
            });

            memory.addMessage("user_a@c.us", "user", "  Prova amanhã  ", 1000);
            memory.addMessage("user_a@c.us", "assistant", "Qual a matéria?", 1010);
            memory.addMessage("user_a@c.us", "system", "Ignorar role inválido", 1020);
            memory.addMessage("user_a@c.us", "user", "   ", 1030);
            memory.addMessage("", "user", "Ignorar user vazio", 1040);

            const history = memory.getHistory("user_a@c.us", 1050);
            assert.deepEqual(history, [
                { role: "user", text: "Prova amanhã", timestamp: 1000 },
                { role: "assistant", text: "Qual a matéria?", timestamp: 1010 },
            ]);

            history[0].text = "mutado";
            assert.equal(
                memory.getHistory("user_a@c.us", 1050)[0].text,
                "Prova amanhã"
            );
        });

        it("respeita limite maxMessagesPerUser mantendo apenas os turnos mais recentes", () => {
            const memory = createConversationMemory({
                maxMessagesPerUser: 3,
                ttlMs: 60_000,
                maxUsers: 10,
            });

            memory.addMessage("user_1", "user", "msg 1", 100);
            memory.addMessage("user_1", "assistant", "msg 2", 200);
            memory.addMessage("user_1", "user", "msg 3", 300);
            memory.addMessage("user_1", "assistant", "msg 4", 400);

            assert.deepEqual(
                memory.getHistory("user_1", 500).map((entry) => entry.text),
                ["msg 2", "msg 3", "msg 4"]
            );
        });

        it("expira mensagens após ttlMs", () => {
            const memory = createConversationMemory({
                maxMessagesPerUser: 6,
                ttlMs: 1000,
                maxUsers: 10,
            });

            memory.addMessage("user_ttl", "user", "Prova amanhã", 1000);
            assert.equal(memory.getHistory("user_ttl", 2000).length, 1);
            assert.deepEqual(memory.getHistory("user_ttl", 2001), []);
        });

        it("faz eviction do usuário mais antigo ao atingir maxUsers e poda expirados antes", () => {
            const memory = createConversationMemory({
                maxMessagesPerUser: 6,
                ttlMs: 1000,
                maxUsers: 2,
            });

            memory.addMessage("user_1", "user", "m1", 100);
            memory.addMessage("user_2", "user", "m2", 200);
            memory.addMessage("user_3", "user", "m3", 300);

            assert.deepEqual(memory.getHistory("user_1", 400), []);
            assert.equal(memory.getHistory("user_2", 400).length, 1);
            assert.equal(memory.getHistory("user_3", 400).length, 1);

            const memoryWithPrune = createConversationMemory({
                maxMessagesPerUser: 6,
                ttlMs: 500,
                maxUsers: 2,
            });
            memoryWithPrune.addMessage("expired_user", "user", "antiga", 100);
            memoryWithPrune.addMessage("active_user", "user", "recente", 700);
            memoryWithPrune.addMessage("new_user", "user", "nova", 900);

            assert.deepEqual(memoryWithPrune.getHistory("expired_user", 900), []);
            assert.equal(memoryWithPrune.getHistory("active_user", 900).length, 1);
            assert.equal(memoryWithPrune.getHistory("new_user", 900).length, 1);
        });

        it("clearHistory limpa apenas o usuário especificado ou todo o histórico", () => {
            const memory = createConversationMemory();
            memory.addMessage("u1", "user", "msg u1", 100);
            memory.addMessage("u2", "user", "msg u2", 100);

            memory.clearHistory("u1");
            assert.deepEqual(memory.getHistory("u1", 200), []);
            assert.equal(memory.getHistory("u2", 200).length, 1);

            memory.clearHistory();
            assert.deepEqual(memory.getHistory("u2", 200), []);
        });
    });
});

describe("Task_Repository schemas e Model/Task", () => {
    describe("atividade_schema", () => {
        it("não contém o typo 'descruption' e possui description válida em todas as propriedades", () => {
            for (const [propName, propConfig] of Object.entries(
                atividade_schema.properties
            )) {
                assert.equal(
                    Object.hasOwn(propConfig, "descruption"),
                    false,
                    `Propriedade "${propName}" não deve conter typo "descruption"`
                );
                assert.equal(typeof propConfig.description, "string");
                assert.ok(propConfig.description.trim().length > 0);
            }
        });

        it("inclui 'sucesso' e 'retorno' em required e enum coerente com TASK_TYPES", () => {
            assert.ok(atividade_schema.required.includes("sucesso"));
            assert.ok(atividade_schema.required.includes("retorno"));
            assert.deepEqual(atividade_schema.properties.tipo.enum, TASK_TYPES);
        });
    });

    describe("isValidCalendarDate", () => {
        it("valida datas reais de calendário e rejeita datas inexistentes", () => {
            assert.equal(isValidCalendarDate("2026-11-25"), true);
            assert.equal(isValidCalendarDate("2024-02-29"), true);
            assert.equal(isValidCalendarDate("2026-02-29"), false);
            assert.equal(isValidCalendarDate("2026-02-31"), false);
            assert.equal(isValidCalendarDate("25-11-2026"), false);
        });
    });

    describe("aiTaskResponseSchema", () => {
        it("aceita resposta válida com sucesso: true", () => {
            const parsed = aiTaskResponseSchema.parse({
                sucesso: true,
                titulo: "Prova de Matemática",
                materia: "Matemática",
                tipo: "prova",
                data_entrega: "2026-11-25",
                observacoes: "Capítulos 3 e 4",
                nota: 15,
                retorno: null,
            });

            assert.equal(parsed.sucesso, true);
            assert.equal(parsed.titulo, "Prova de Matemática");
            assert.equal(parsed.nota, 15);
        });

        it("rejeita data inválida como 2026-02-31 quando sucesso: true", () => {
            const result = aiTaskResponseSchema.safeParse({
                sucesso: true,
                titulo: "Trabalho de História",
                materia: "História",
                tipo: "trabalho",
                data_entrega: "2026-02-31",
                observacoes: null,
                nota: 10,
                retorno: null,
            });

            assert.equal(result.success, false);
        });

        it("rejeita titulo com mais de 255 caracteres e normaliza materia/observacoes vazios para null", () => {
            const tooLongTitle = aiTaskResponseSchema.safeParse({
                sucesso: true,
                titulo: "a".repeat(256),
                materia: "Matemática",
                tipo: "prova",
                data_entrega: "2026-11-25",
                observacoes: null,
                nota: 10,
                retorno: null,
            });
            assert.equal(tooLongTitle.success, false);

            const normalized = aiTaskResponseSchema.parse({
                sucesso: true,
                titulo: "Prova de Matemática",
                materia: "   ",
                tipo: "prova",
                data_entrega: "2026-11-25",
                observacoes: "",
                nota: 10,
                retorno: null,
            });
            assert.equal(normalized.materia, null);
            assert.equal(normalized.observacoes, null);
        });

        it("aceita resposta com sucesso: false contendo campos nulos ou vazios", () => {
            const parsedNulls = aiTaskResponseSchema.parse({
                sucesso: false,
                titulo: null,
                materia: null,
                tipo: null,
                data_entrega: null,
                observacoes: null,
                nota: null,
                retorno: "Qual é a matéria e a data de entrega?",
            });

            assert.equal(parsedNulls.sucesso, false);
            assert.equal(
                parsedNulls.retorno,
                "Qual é a matéria e a data de entrega?"
            );

            const parsedEmpties = aiTaskResponseSchema.parse({
                sucesso: false,
                titulo: "",
                materia: "",
                tipo: "",
                data_entrega: "",
                retorno: "Não entendi a atividade.",
            });

            assert.equal(parsedEmpties.sucesso, false);
        });
    });

    describe("createTaskBodySchema e updateTaskBodySchema", () => {
        it("valida criação de tarefa e rejeita campos extras (.strict())", () => {
            const valid = createTaskBodySchema.safeParse({
                whatsapp_id: "user_1@c.us",
                titulo: "Seminário de Redes",
                materia: "Redes",
                tipo: "apresentacao",
                data_entrega: "2026-10-15",
                observacoes: "Grupo de 3 pessoas",
                nota: 12.5,
            });

            assert.equal(valid.success, true);

            const withExtraField = createTaskBodySchema.safeParse({
                titulo: "Seminário de Redes",
                tipo: "apresentacao",
                campo_desconhecido: "invalido",
            });

            assert.equal(withExtraField.success, false);

            const normalized = createTaskBodySchema.parse({
                titulo: "Seminário de Redes",
                materia: "   ",
                tipo: "apresentacao",
                observacoes: "",
            });

            assert.equal(normalized.materia, null);
            assert.equal(normalized.observacoes, null);

            const tooLongTitle = createTaskBodySchema.safeParse({
                titulo: "x".repeat(256),
                tipo: "trabalho",
            });
            assert.equal(tooLongTitle.success, false);
        });

        it("rejeita objeto vazio {} e campos extras no updateTaskBodySchema", () => {
            assert.equal(updateTaskBodySchema.safeParse({}).success, false);
            assert.equal(
                updateTaskBodySchema.safeParse({ extra: 123 }).success,
                false
            );
            assert.equal(
                updateTaskBodySchema.safeParse({ nota: 0 }).success,
                true
            );
            assert.equal(
                updateTaskBodySchema.safeParse({ titulo: "Atualizado" }).success,
                true
            );
        });
    });

    describe("Task model", () => {
        it("constrói instância via objeto e extrai apenas campos persistíveis em toPersistenceData()", () => {
            const task = new Task({
                id: 42,
                whatsapp_id: "5511999999999@c.us",
                titulo: "Prova Final",
                materia: "Algoritmos",
                tipo: "prova",
                data_entrega: "2026-12-01",
                observacoes: "Sem consulta",
                nota: 30,
                sucesso: true,
                retorno: null,
            });

            assert.equal(task.id, 42);
            assert.equal(task.whatsapp_id, "5511999999999@c.us");
            assert.deepEqual(task.toPersistenceData(), {
                titulo: "Prova Final",
                materia: "Algoritmos",
                tipo: "prova",
                data_entrega: "2026-12-01",
                observacoes: "Sem consulta",
                nota: 30,
            });
        });

        it("mantém compatibilidade com construtor posicional legado", () => {
            const task = new Task(
                "Resumo",
                "Filosofia",
                "leitura",
                "2026-09-10",
                "Capítulo 2",
                5,
                true,
                null
            );

            assert.deepEqual(task.toPersistenceData(), {
                titulo: "Resumo",
                materia: "Filosofia",
                tipo: "leitura",
                data_entrega: "2026-09-10",
                observacoes: "Capítulo 2",
                nota: 5,
            });
            assert.equal(task.sucesso, true);
            assert.equal(task.retorno, null);
        });
    });

    describe("createInMemoryTaskRepository e testTaskStorage", () => {
        after(() => {
            testTaskStorage.clear();
        });

        it("mantém numeração sequencial densa (1..N) por usuário após apagar o último ou o primeiro item", () => {
            const repo = createInMemoryTaskRepository();
            const userA = "user_a@c.us";
            const userB = "user_b@c.us";

            const a1 = repo.createTask(userA, {
                titulo: "Prova A1",
                tipo: "prova",
                nota: 10,
            });
            const a2 = repo.createTask(userA, {
                titulo: "Trabalho A2",
                tipo: "trabalho",
            });
            const a3 = repo.createTask(userA, {
                titulo: "Leitura A3",
                tipo: "leitura",
            });
            const b1 = repo.createTask(userB, {
                titulo: "Leitura B1",
                tipo: "leitura",
            });
            const b2 = repo.createTask(userB, {
                titulo: "Exercício B2",
                tipo: "exercicio",
            });

            assert.deepEqual(
                [a1.id, a2.id, a3.id],
                [1, 2, 3]
            );
            assert.deepEqual(
                [b1.id, b2.id],
                [1, 2]
            );

            // Cenário 1: apagar o último item (3) faz a próxima atividade assumir o ID 3
            assert.equal(repo.deleteUserTask(userA, 3), true);
            assert.equal(repo.deleteUserTask(userA, 3), false);
            assert.equal(repo.deleteUserTask(userA, 0), false);

            const aNewThird = repo.createTask(userA, {
                titulo: "Nova A3",
                tipo: "prova",
            });
            assert.equal(aNewThird.id, 3);
            assert.equal(aNewThird.user_task_id, 3);

            // Cenário 2: [1, 2, 3, 4] -> apaga 1 -> antiga 2 vira 1, 3 vira 2, 4 vira 3
            repo.createTask(userA, { titulo: "Quarta A4", tipo: "outro" });
            assert.equal(repo.deleteUserTask(userA, 1), true);

            const reindexedA = repo.listTasks({ whatsappId: userA });
            assert.deepEqual(
                reindexedA.map((t) => ({
                    id: t.id,
                    user_task_id: t.user_task_id,
                    titulo: t.titulo,
                })),
                [
                    { id: 1, user_task_id: 1, titulo: "Trabalho A2" },
                    { id: 2, user_task_id: 2, titulo: "Nova A3" },
                    { id: 3, user_task_id: 3, titulo: "Quarta A4" },
                ]
            );

            const aNewFourth = repo.createTask(userA, {
                titulo: "Nova A4",
                tipo: "trabalho",
            });
            assert.equal(aNewFourth.id, 4);
            assert.equal(aNewFourth.user_task_id, 4);

            // Isolamento do userB preservado
            assert.deepEqual(
                repo.listTasks({ whatsappId: userB }).map((t) => ({
                    id: t.id,
                    titulo: t.titulo,
                })),
                [
                    { id: 1, titulo: "Leitura B1" },
                    { id: 2, titulo: "Exercício B2" },
                ]
            );
        });

        it("clear(whatsappId) limpa apenas o usuário informado e clear() zera tudo e reseta contadores para 1", () => {
            const repo = createInMemoryTaskRepository();

            repo.createTask("u1@c.us", { titulo: "T1", tipo: "outro" });
            repo.createTask("u1@c.us", { titulo: "T2", tipo: "outro" });
            repo.createTask("u2@c.us", { titulo: "T3", tipo: "outro" });

            assert.equal(repo.count(), 3);
            assert.equal(repo.count("u1@c.us"), 2);

            const removedU1 = repo.clear("u1@c.us");
            assert.equal(removedU1, 2);
            assert.equal(repo.count("u1@c.us"), 0);
            assert.equal(repo.count("u2@c.us"), 1);

            const removedAll = repo.clear();
            assert.equal(removedAll, 1);
            assert.equal(repo.count(), 0);
            assert.deepEqual(repo.listTasks(), []);

            const restarted = repo.createTask("u2@c.us", {
                titulo: "Reiniciada",
                tipo: "trabalho",
            });
            assert.equal(restarted.id, 1);
            assert.equal(restarted.user_task_id, 1);
        });

        it("singleton testTaskStorage opera em memória e é limpo corretamente", () => {
            testTaskStorage.clear();
            try {
                const created = testTaskStorage.createTask("admin_unit@c.us", {
                    titulo: "Simulação",
                    tipo: "prova",
                });
                assert.equal(created.id, 1);
                assert.equal(testTaskStorage.count("admin_unit@c.us"), 1);
            } finally {
                testTaskStorage.clear();
            }
            assert.equal(testTaskStorage.count(), 0);
        });

        it("deleteTask sem whatsappId lança erro explícito para evitar remoção cross-user", () => {
            const repo = createInMemoryTaskRepository();
            repo.createTask("user_a@c.us", {
                titulo: "Tarefa protegida",
                tipo: "trabalho",
            });

            assert.throws(
                () => repo.deleteTask(1),
                /whatsappId é obrigatório/
            );
            assert.throws(
                () => repo.deleteTask(1, {}),
                /whatsappId é obrigatório/
            );
            assert.equal(repo.count("user_a@c.us"), 1);
        });
    });
});

describe("config/env - loadEnv", () => {
    const baseSyntheticEnv = {
        GEMINI_API_KEY: "synthetic-gemini-key-test-only",
        DB_HOST: "127.0.0.1",
        DB_PORT: "5432",
        DB_USER: "synthetic_user",
        DB_PASSWORD: "synthetic-db-password-test-only",
        DB_NAME: "synthetic_db",
    };

    it("aplica defaults, converte portas numéricas e congela o objeto retornado", () => {
        const loaded = loadEnv(baseSyntheticEnv);

        assert.equal(loaded.DB_PORT, 5432);
        assert.equal(loaded.HTTP_PORT, 3000);
        assert.equal(loaded.GEMINI_MODEL, "gemini-3.1-flash-lite");
        assert.deepEqual(loaded.GEMINI_FALLBACK_MODELS, [
            "gemini-2.5-flash-lite",
            "gemini-2.5-flash",
            "gemini-2.0-flash",
        ]);
        assert.equal(loaded.ADMIN_TEST_NUMBER, undefined);
        assert.equal(Object.isFrozen(loaded), true);
        assert.equal(Object.isFrozen(loaded.GEMINI_FALLBACK_MODELS), true);
    });

    it("trata ADMIN_TEST_NUMBER preenchido, vazio e ausente", () => {
        const withAdmin = loadEnv({
            ...baseSyntheticEnv,
            ADMIN_TEST_NUMBER: "  5511999998888  ",
        });
        assert.equal(withAdmin.ADMIN_TEST_NUMBER, "5511999998888");

        const withEmptyAdmin = loadEnv({
            ...baseSyntheticEnv,
            ADMIN_TEST_NUMBER: "",
        });
        assert.equal(withEmptyAdmin.ADMIN_TEST_NUMBER, undefined);

        const withWhitespaceAdmin = loadEnv({
            ...baseSyntheticEnv,
            ADMIN_TEST_NUMBER: "   ",
        });
        assert.equal(withWhitespaceAdmin.ADMIN_TEST_NUMBER, undefined);

        const withoutAdmin = loadEnv({ ...baseSyntheticEnv });
        assert.equal(withoutAdmin.ADMIN_TEST_NUMBER, undefined);
    });

    it("faz parsing de GEMINI_FALLBACK_MODELS a partir de CSV e array", () => {
        const fromCsv = loadEnv({
            ...baseSyntheticEnv,
            GEMINI_FALLBACK_MODELS:
                " gemini-2.5-flash-lite , , gemini-2.5-flash ",
        });

        assert.deepEqual(fromCsv.GEMINI_FALLBACK_MODELS, [
            "gemini-2.5-flash-lite",
            "gemini-2.5-flash",
        ]);
        assert.equal(Object.isFrozen(fromCsv.GEMINI_FALLBACK_MODELS), true);

        const fromArray = loadEnv({
            ...baseSyntheticEnv,
            GEMINI_FALLBACK_MODELS: ["gemini-a", "gemini-b"],
        });

        assert.deepEqual(fromArray.GEMINI_FALLBACK_MODELS, [
            "gemini-a",
            "gemini-b",
        ]);

        const fromBlankCsv = loadEnv({
            ...baseSyntheticEnv,
            GEMINI_FALLBACK_MODELS: " ,  ",
        });

        assert.deepEqual(fromBlankCsv.GEMINI_FALLBACK_MODELS, [
            "gemini-2.5-flash-lite",
            "gemini-2.5-flash",
            "gemini-2.0-flash",
        ]);
    });

    it("aplica defaults quando variáveis opcionais são strings vazias ou espaços", () => {
        const loaded = loadEnv({
            ...baseSyntheticEnv,
            HTTP_PORT: "",
            GEMINI_MODEL: "   ",
            CHROME_EXECUTABLE_PATH: "",
        });

        assert.equal(loaded.HTTP_PORT, 3000);
        assert.equal(loaded.GEMINI_MODEL, "gemini-3.1-flash-lite");
        assert.equal(loaded.CHROME_EXECUTABLE_PATH, undefined);
    });

    it("falha rápido (fail-fast) em variáveis inválidas ou ausentes sem vazar segredos", () => {
        const fakeSecretKey = "SECRET_SHOULD_NEVER_APPEAR_IN_ERRORS_KEY";
        const fakeSecretPassword = "SECRET_SHOULD_NEVER_APPEAR_IN_ERRORS_PWD";

        assert.throws(
            () =>
                loadEnv({
                    GEMINI_API_KEY: fakeSecretKey,
                    DB_HOST: "127.0.0.1",
                    DB_PORT: "porta-invalida",
                    DB_USER: "synthetic_user",
                    DB_PASSWORD: fakeSecretPassword,
                    DB_NAME: "",
                }),
            (error) => {
                assert.ok(error instanceof Error);
                assert.match(error.message, /DB_PORT/);
                assert.match(error.message, /DB_NAME/);
                assert.equal(error.message.includes(fakeSecretKey), false);
                assert.equal(error.message.includes(fakeSecretPassword), false);
                return true;
            }
        );

        assert.throws(
            () => loadEnv({}),
            (error) => {
                assert.ok(error instanceof Error);
                assert.match(error.message, /GEMINI_API_KEY/);
                assert.match(error.message, /DB_PASSWORD/);
                return true;
            }
        );
    });
});
