import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    commands,
    readable_date,
    sucess_task_msg,
} from "../../src/Repository/Messages_Repository.js";
import {
    TASK_TYPES,
    atividade_schema,
    aiTaskResponseSchema,
    createTaskBodySchema,
    updateTaskBodySchema,
    isValidCalendarDate,
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
        it("formata mensagem completa com todos os campos informados", () => {
            const msg = sucess_task_msg({
                titulo: "Prova de Cálculo",
                materia: "Matemática",
                nota: 15,
                data_entrega: "2026-11-25",
            });

            assert.equal(
                msg,
                `*Titulo*: Prova de Cálculo
*Materia*: Matemática
*Nota*: 15
*Data* de entrega: 25/11`
            );
        });

        it("preserva nota igual a 0 sem substituir por fallback", () => {
            const msg = sucess_task_msg({
                titulo: "Lista de Exercícios",
                materia: "Física",
                nota: 0,
                data_entrega: "2026-06-10",
            });

            assert.match(msg, /\*Nota\*: 0/);
        });

        it("usa 'Não informada' como fallback para campos nulos, indefinidos ou vazios", () => {
            const msg = sucess_task_msg({
                titulo: "  ",
                materia: null,
                nota: undefined,
                data_entrega: null,
            });

            assert.equal(
                msg,
                `*Titulo*: Não informada
*Materia*: Não informada
*Nota*: Não informada
*Data* de entrega: Não informada`
            );
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
        assert.equal(Object.isFrozen(loaded), true);
        assert.equal(Object.isFrozen(loaded.GEMINI_FALLBACK_MODELS), true);
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
