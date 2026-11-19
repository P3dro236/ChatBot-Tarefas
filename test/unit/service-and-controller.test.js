import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    buildPrompt,
    isGeminiOverloadedError,
    resolveCandidateModels,
    shouldFallbackToNextModel,
    text_to_json,
} from "../../src/Service/Service.js";
import {
    createMessageHandler,
    getSenderId,
    MAX_MESSAGE_LENGTH,
    MAX_SENDER_ID_LENGTH,
} from "../../src/Controller/Controller.js";
import { startApplication } from "../../src/app.js";
import {
    commands,
    DEFAULT_FALLBACK_REPLY,
    EMPTY_TASKS_MESSAGE,
    GEMINI_OVERLOADED_MESSAGE,
    GENERIC_ERROR_MESSAGE,
    MESSAGE_TOO_LONG_MESSAGE,
    TASK_SAVED_MESSAGE,
    sucess_task_msg,
} from "../../src/Repository/Messages_Repository.js";
import { atividade_schema } from "../../src/Repository/Task_Repository.js";

function formatExpectedLocalDateTime(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");

    const offsetMinutes = -date.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? "+" : "-";
    const absOffset = Math.abs(offsetMinutes);
    const offsetHours = String(Math.floor(absOffset / 60)).padStart(2, "0");
    const offsetMins = String(absOffset % 60).padStart(2, "0");

    return `${year}-${month}-${day} ${hours}:${minutes} (UTC${sign}${offsetHours}:${offsetMins})`;
}

describe("Service.js", () => {
    describe("buildPrompt", () => {
        it("inclui a data atual no formato local YYYY-MM-DD HH:mm (UTC±HH:MM) e a mensagem do usuário", () => {
            const fixedDate = new Date("2026-11-18T12:00:00.000Z");
            const expectedLocal = formatExpectedLocalDateTime(fixedDate);
            const prompt = buildPrompt(
                "Prova de Cálculo amanhã valendo 10 pontos",
                fixedDate
            );

            assert.ok(
                prompt.includes(`Data atual (horário local): ${expectedLocal}`)
            );
            assert.match(
                prompt,
                /Data atual \(horário local\): \d{4}-\d{2}-\d{2} \d{2}:\d{2} \(UTC[+-]\d{2}:\d{2}\)/
            );
            assert.ok(
                prompt.includes("Prova de Cálculo amanhã valendo 10 pontos")
            );
            assert.ok(prompt.includes("YYYY-MM-DD"));
        });

        it("faz fallback seguro para a data atual quando recebe Invalid Date sem lançar RangeError", async () => {
            const prompt = buildPrompt(
                "Entrega de projeto",
                new Date("invalid-date")
            );

            assert.match(
                prompt,
                /Data atual \(horário local\): \d{4}-\d{2}-\d{2} \d{2}:\d{2} \(UTC[+-]\d{2}:\d{2}\)/
            );
            assert.equal(prompt.includes("NaN"), false);

            let capturedContents = "";
            const fakeAiClient = {
                models: {
                    async generateContent({ contents }) {
                        capturedContents = contents;
                        return {
                            text: JSON.stringify({
                                sucesso: true,
                                titulo: "Entrega de Projeto",
                                materia: null,
                                tipo: "trabalho",
                                data_entrega: null,
                                observacoes: null,
                                nota: null,
                                retorno: null,
                            }),
                        };
                    },
                },
            };

            const result = await text_to_json("Entrega de projeto", {
                aiClient: fakeAiClient,
                models: ["model-test"],
                now: new Date("invalid-date"),
            });

            assert.equal(result.sucesso, true);
            assert.match(
                capturedContents,
                /Data atual \(horário local\): \d{4}-\d{2}-\d{2} \d{2}:\d{2} \(UTC[+-]\d{2}:\d{2}\)/
            );
            assert.equal(capturedContents.includes("NaN"), false);
        });
    });

    describe("resolveCandidateModels", () => {
        it("remove duplicatas, espaços e valores inválidos preservando a ordem", () => {
            const models = resolveCandidateModels([
                " gemini-3.1-flash-lite ",
                "",
                null,
                "gemini-2.5-flash-lite",
                "gemini-3.1-flash-lite",
                "  gemini-2.5-flash",
            ]);

            assert.deepEqual(models, [
                "gemini-3.1-flash-lite",
                "gemini-2.5-flash-lite",
                "gemini-2.5-flash",
            ]);
        });

        it("usa os modelos configurados no ambiente quando depsModels não é informado", () => {
            const models = resolveCandidateModels();

            assert.ok(Array.isArray(models));
            assert.ok(models.length >= 1);
            assert.equal(new Set(models).size, models.length);
        });
    });

    describe("isGeminiOverloadedError", () => {
        it("retorna true para 503, 429/RESOURCE_EXHAUSTED/quota, response.status e strings '503'/'429'", () => {
            assert.equal(isGeminiOverloadedError({ status: 503 }), true);
            assert.equal(isGeminiOverloadedError({ code: 503 }), true);
            assert.equal(
                isGeminiOverloadedError({ error: { code: 503 } }),
                true
            );
            assert.equal(isGeminiOverloadedError({ status: 429 }), true);
            assert.equal(
                isGeminiOverloadedError(
                    new Error("RESOURCE_EXHAUSTED: quota exceeded")
                ),
                true
            );
            assert.equal(
                isGeminiOverloadedError(new Error("Daily quota limit reached")),
                true
            );
            assert.equal(
                isGeminiOverloadedError({ response: { status: 503 } }),
                true
            );
            assert.equal(
                isGeminiOverloadedError({ response: { status: 429 } }),
                true
            );
            assert.equal(isGeminiOverloadedError({ status: "503" }), true);
            assert.equal(isGeminiOverloadedError({ code: "429" }), true);
            assert.equal(
                isGeminiOverloadedError({ response: { status: "429" } }),
                true
            );
            assert.equal(
                isGeminiOverloadedError(new Error("Upstream returned 503")),
                true
            );
            assert.equal(
                isGeminiOverloadedError(new Error("Rate limited with 429")),
                true
            );
        });

        it("retorna false para 404, 400, erros genéricos, null e primitivos", () => {
            assert.equal(isGeminiOverloadedError({ status: 404 }), false);
            assert.equal(
                isGeminiOverloadedError(new Error("Model NOT_FOUND")),
                false
            );
            assert.equal(isGeminiOverloadedError({ status: 400 }), false);
            assert.equal(
                isGeminiOverloadedError(new Error("Bad Request")),
                false
            );
            assert.equal(isGeminiOverloadedError(null), false);
            assert.equal(isGeminiOverloadedError("503"), false);
        });
    });

    describe("shouldFallbackToNextModel", () => {
        it("retorna true para erros 503, 429/quota e 404/NOT_FOUND", () => {
            assert.equal(shouldFallbackToNextModel({ status: 503 }), true);
            assert.equal(
                shouldFallbackToNextModel({
                    error: { code: 503, status: "UNAVAILABLE" },
                }),
                true
            );
            assert.equal(
                shouldFallbackToNextModel(new Error("Model is overloaded")),
                true
            );
            assert.equal(shouldFallbackToNextModel({ status: 429 }), true);
            assert.equal(
                shouldFallbackToNextModel(
                    new Error("RESOURCE_EXHAUSTED: quota exceeded")
                ),
                true
            );
            assert.equal(shouldFallbackToNextModel({ code: 404 }), true);
            assert.equal(
                shouldFallbackToNextModel(new Error("Model NOT_FOUND")),
                true
            );
        });

        it("retorna false para erros não retryable ou valores inválidos", () => {
            assert.equal(shouldFallbackToNextModel({ status: 400 }), false);
            assert.equal(shouldFallbackToNextModel({ status: 401 }), false);
            assert.equal(shouldFallbackToNextModel({ status: 403 }), false);
            assert.equal(
                shouldFallbackToNextModel(new Error("Invalid argument")),
                false
            );
            assert.equal(shouldFallbackToNextModel(null), false);
            assert.equal(shouldFallbackToNextModel("503"), false);
        });
    });

    describe("text_to_json com fallback automático de modelo", () => {
        it("faz fallback de 503 -> 429 -> sucesso no terceiro modelo", async (t) => {
            const warnMock = t.mock.method(console, "warn", () => {});
            const attemptedModels = [];
            let capturedConfig = null;

            const fakeAiClient = {
                models: {
                    async generateContent({ model, config }) {
                        attemptedModels.push(model);
                        capturedConfig = config;

                        if (model === "model-primary") {
                            const err = new Error("Service Unavailable");
                            err.status = 503;
                            throw err;
                        }

                        if (model === "model-secondary") {
                            const err = new Error("RESOURCE_EXHAUSTED: quota");
                            err.status = 429;
                            throw err;
                        }

                        return {
                            text: JSON.stringify({
                                sucesso: true,
                                titulo: "Prova de Física",
                                materia: "Física",
                                tipo: "prova",
                                data_entrega: "2026-11-20",
                                observacoes: "Capítulo 2",
                                nota: 10,
                                retorno: null,
                            }),
                        };
                    },
                },
            };

            const result = await text_to_json("Prova de Física dia 20/11", {
                aiClient: fakeAiClient,
                models: ["model-primary", "model-secondary", "model-tertiary"],
                now: new Date("2026-11-18T12:00:00.000Z"),
            });

            assert.deepEqual(attemptedModels, [
                "model-primary",
                "model-secondary",
                "model-tertiary",
            ]);
            assert.equal(capturedConfig.responseMimeType, "application/json");
            assert.deepEqual(
                capturedConfig.responseJsonSchema,
                atividade_schema
            );
            assert.equal(result.sucesso, true);
            assert.equal(result.titulo, "Prova de Física");
            assert.equal(result.nota, 10);
            assert.equal(warnMock.mock.callCount(), 2);
        });

        it("propaga erro 503 quando todos os modelos candidatos falham", async (t) => {
            t.mock.method(console, "warn", () => {});
            const attemptedModels = [];

            const fakeAiClient = {
                models: {
                    async generateContent({ model }) {
                        attemptedModels.push(model);
                        const err = new Error(`Overloaded on ${model}`);
                        err.status = 503;
                        throw err;
                    },
                },
            };

            await assert.rejects(
                () =>
                    text_to_json("Trabalho de Química", {
                        aiClient: fakeAiClient,
                        models: ["model-1", "model-2"],
                        now: new Date("2026-11-18T12:00:00.000Z"),
                    }),
                (error) => {
                    assert.equal(error.status, 503);
                    return true;
                }
            );

            assert.deepEqual(attemptedModels, ["model-1", "model-2"]);
        });

        it("preserva e relança erro 503 quando fallback subsequente falha com 404", async (t) => {
            t.mock.method(console, "warn", () => {});
            const attemptedModels = [];

            const fakeAiClient = {
                models: {
                    async generateContent({ model }) {
                        attemptedModels.push(model);

                        if (model === "model-primary") {
                            const err = new Error("Service Unavailable");
                            err.status = 503;
                            throw err;
                        }

                        const notFoundErr = new Error("Model NOT_FOUND");
                        notFoundErr.status = 404;
                        throw notFoundErr;
                    },
                },
            };

            await assert.rejects(
                () =>
                    text_to_json("Prova de Biologia", {
                        aiClient: fakeAiClient,
                        models: ["model-primary", "model-deprecated"],
                        now: new Date("2026-11-18T12:00:00.000Z"),
                    }),
                (error) => {
                    assert.equal(error.status, 503);
                    assert.equal(error.message, "Service Unavailable");
                    return true;
                }
            );

            assert.deepEqual(attemptedModels, [
                "model-primary",
                "model-deprecated",
            ]);
        });

        it("não tenta fallback quando o erro não é retryable (ex: 400)", async () => {
            const attemptedModels = [];

            const fakeAiClient = {
                models: {
                    async generateContent({ model }) {
                        attemptedModels.push(model);
                        const err = new Error("Bad Request");
                        err.status = 400;
                        throw err;
                    },
                },
            };

            await assert.rejects(
                () =>
                    text_to_json("Trabalho de Química", {
                        aiClient: fakeAiClient,
                        models: ["model-1", "model-2"],
                    }),
                (error) => {
                    assert.equal(error.status, 400);
                    return true;
                }
            );

            assert.deepEqual(attemptedModels, ["model-1"]);
        });

        it("lança erro quando o modelo retorna JSON malformado ou texto vazio", async () => {
            const malformedAttempts = [];
            const malformedClient = {
                models: {
                    async generateContent({ model }) {
                        malformedAttempts.push(model);
                        return { text: "{json_invalido" };
                    },
                },
            };

            await assert.rejects(
                () =>
                    text_to_json("Prova de História", {
                        aiClient: malformedClient,
                        models: ["model-1", "model-2"],
                    }),
                SyntaxError
            );
            assert.deepEqual(malformedAttempts, ["model-1"]);

            const emptyAttempts = [];
            const emptyClient = {
                models: {
                    async generateContent({ model }) {
                        emptyAttempts.push(model);
                        return { text: "" };
                    },
                },
            };

            await assert.rejects(
                () =>
                    text_to_json("Prova de História", {
                        aiClient: emptyClient,
                        models: ["model-1", "model-2"],
                    }),
                (error) => {
                    assert.ok(error instanceof Error);
                    assert.match(error.message, /Resposta vazia/);
                    return true;
                }
            );
            assert.deepEqual(emptyAttempts, ["model-1"]);
        });
    });
});

describe("Controller.js - getSenderId e createMessageHandler", () => {
    function createFakeMsg(body, from = "5511999999999@c.us") {
        const replies = [];
        return {
            from,
            body,
            replies,
            async reply(text) {
                replies.push(text);
            },
        };
    }

    it("getSenderId retorna 'default_user' sem msg.from e trunca IDs acima de 100 caracteres", () => {
        assert.equal(getSenderId(null), "default_user");
        assert.equal(getSenderId({}), "default_user");
        assert.equal(getSenderId({ from: "   " }), "default_user");
        assert.equal(getSenderId({ from: 12345 }), "default_user");
        assert.equal(getSenderId({ from: "  user_1@c.us  " }), "user_1@c.us");

        const longId = "u".repeat(MAX_SENDER_ID_LENGTH + 45);
        const normalized = getSenderId({ from: longId });
        assert.equal(normalized.length, MAX_SENDER_ID_LENGTH);
        assert.equal(normalized, "u".repeat(MAX_SENDER_ID_LENGTH));
    });

    it("ignora mensagens nulas, vazias, só com espaços ou com body não-string (guard clauses)", async () => {
        let extractCalled = false;
        let repoCalled = false;

        const handler = createMessageHandler({
            extractTask: async () => {
                extractCalled = true;
                return { sucesso: false };
            },
            taskRepository: {
                listTasks: async () => {
                    repoCalled = true;
                    return [];
                },
                createTask: async () => {
                    repoCalled = true;
                    return null;
                },
            },
        });

        await handler(null);
        await handler(undefined);

        const nonStringMsg = createFakeMsg(12345);
        await handler(nonStringMsg);

        const emptyMsg = createFakeMsg("");
        await handler(emptyMsg);

        const whitespaceMsg = createFakeMsg("   \n\t  ");
        await handler(whitespaceMsg);

        assert.equal(extractCalled, false);
        assert.equal(repoCalled, false);
        assert.deepEqual(nonStringMsg.replies, []);
        assert.deepEqual(emptyMsg.replies, []);
        assert.deepEqual(whitespaceMsg.replies, []);
    });

    it("responde MESSAGE_TOO_LONG_MESSAGE sem chamar extractTask para mensagens acima de 4000 caracteres", async () => {
        let extractCalled = false;
        let repoCalled = false;

        const handler = createMessageHandler({
            extractTask: async () => {
                extractCalled = true;
                return { sucesso: false };
            },
            taskRepository: {
                listTasks: async () => {
                    repoCalled = true;
                    return [];
                },
                createTask: async () => {
                    repoCalled = true;
                    return null;
                },
            },
        });

        const msg = createFakeMsg("a".repeat(MAX_MESSAGE_LENGTH + 1));
        await handler(msg);

        assert.equal(extractCalled, false);
        assert.equal(repoCalled, false);
        assert.deepEqual(msg.replies, [MESSAGE_TOO_LONG_MESSAGE]);
    });

    it("responde ao comando 'comandos' de forma case-insensitive", async () => {
        let extractCalled = false;
        const handler = createMessageHandler({
            extractTask: async () => {
                extractCalled = true;
                return { sucesso: false };
            },
            taskRepository: {
                listTasks: async () => [],
                createTask: async () => null,
            },
        });

        const msg = createFakeMsg("  CoMaNdOs  ");
        await handler(msg);

        assert.equal(extractCalled, false);
        assert.deepEqual(msg.replies, [commands]);
    });

    it("responde ao comando 'todas' quando não há tarefas cadastradas", async () => {
        const requestedUsers = [];
        const handler = createMessageHandler({
            extractTask: async () => {
                throw new Error("Não deveria chamar IA");
            },
            taskRepository: {
                listTasks: async ({ whatsappId }) => {
                    requestedUsers.push(whatsappId);
                    return [];
                },
                createTask: async () => null,
            },
        });

        const msg = createFakeMsg("TODAS", "user_empty@c.us");
        await handler(msg);

        assert.deepEqual(requestedUsers, ["user_empty@c.us"]);
        assert.deepEqual(msg.replies, [EMPTY_TASKS_MESSAGE]);
    });

    it("responde ao comando 'todas' enviando cada tarefa formatada", async () => {
        const storedTasks = [
            {
                id: 1,
                titulo: "Prova 1",
                materia: "Cálculo",
                nota: 15,
                data_entrega: "2026-11-25",
            },
            {
                id: 2,
                titulo: "Trabalho Final",
                materia: "Redes",
                nota: 0,
                data_entrega: null,
            },
        ];

        const handler = createMessageHandler({
            extractTask: async () => {
                throw new Error("Não deveria chamar IA");
            },
            taskRepository: {
                listTasks: async () => storedTasks,
                createTask: async () => null,
            },
        });

        const msg = createFakeMsg("todas", "user_tasks@c.us");
        await handler(msg);

        assert.deepEqual(msg.replies, [
            sucess_task_msg(storedTasks[0]),
            sucess_task_msg(storedTasks[1]),
        ]);
    });

    it("cria tarefa e envia confirmação quando extractTask retorna sucesso: true", async () => {
        const createdCalls = [];
        const handler = createMessageHandler({
            extractTask: async () => ({
                sucesso: true,
                titulo: "Seminário de IA",
                materia: "Inteligência Artificial",
                tipo: "apresentacao",
                data_entrega: "2026-12-05",
                observacoes: "Em dupla",
                nota: 20,
                retorno: null,
            }),
            taskRepository: {
                listTasks: async () => [],
                createTask: async (whatsappId, data) => {
                    createdCalls.push({ whatsappId, data });
                    return { id: 99, whatsapp_id: whatsappId, ...data };
                },
            },
        });

        const msg = createFakeMsg("Seminário de IA dia 05/12", "user_ok@c.us");
        await handler(msg);

        assert.equal(createdCalls.length, 1);
        assert.equal(createdCalls[0].whatsappId, "user_ok@c.us");
        assert.equal(createdCalls[0].data.titulo, "Seminário de IA");
        assert.equal(msg.replies.length, 2);
        assert.equal(msg.replies[0], TASK_SAVED_MESSAGE);
        assert.equal(
            msg.replies[1],
            sucess_task_msg({
                titulo: "Seminário de IA",
                materia: "Inteligência Artificial",
                nota: 20,
                data_entrega: "2026-12-05",
            })
        );
    });

    it("responde com retorno ou fallback padrão quando extractTask retorna sucesso: false", async () => {
        let createCalled = false;
        const handlerWithReply = createMessageHandler({
            extractTask: async () => ({
                sucesso: false,
                retorno: "  Qual é a data de entrega?  ",
            }),
            taskRepository: {
                listTasks: async () => [],
                createTask: async () => {
                    createCalled = true;
                    return null;
                },
            },
        });

        const msg1 = createFakeMsg("Prova de História");
        await handlerWithReply(msg1);
        assert.equal(createCalled, false);
        assert.deepEqual(msg1.replies, ["Qual é a data de entrega?"]);

        const handlerWithoutReply = createMessageHandler({
            extractTask: async () => ({
                sucesso: false,
                retorno: "   ",
            }),
            taskRepository: {
                listTasks: async () => [],
                createTask: async () => {
                    createCalled = true;
                    return null;
                },
            },
        });

        const msg2 = createFakeMsg("Mensagem aleatória");
        await handlerWithoutReply(msg2);
        assert.equal(createCalled, false);
        assert.deepEqual(msg2.replies, [DEFAULT_FALLBACK_REPLY]);
    });

    it("responde GEMINI_OVERLOADED_MESSAGE em erros 503 e 429/RESOURCE_EXHAUSTED, e GENERIC_ERROR_MESSAGE em erro genérico", async (t) => {
        t.mock.method(console, "error", () => {});

        const handler503 = createMessageHandler({
            extractTask: async () => {
                const err = new Error("Service Unavailable");
                err.status = 503;
                throw err;
            },
            taskRepository: {
                listTasks: async () => [],
                createTask: async () => null,
            },
        });

        const msg503 = createFakeMsg("Prova amanhã");
        await handler503(msg503);
        assert.deepEqual(msg503.replies, [GEMINI_OVERLOADED_MESSAGE]);

        const handler429 = createMessageHandler({
            extractTask: async () => {
                const err = new Error("RESOURCE_EXHAUSTED: quota exceeded");
                err.status = 429;
                throw err;
            },
            taskRepository: {
                listTasks: async () => [],
                createTask: async () => null,
            },
        });

        const msg429 = createFakeMsg("Prova amanhã");
        await handler429(msg429);
        assert.deepEqual(msg429.replies, [GEMINI_OVERLOADED_MESSAGE]);

        const handlerGeneric = createMessageHandler({
            extractTask: async () => {
                throw new Error("Erro inesperado qualquer");
            },
            taskRepository: {
                listTasks: async () => [],
                createTask: async () => null,
            },
        });

        const msgGeneric = createFakeMsg("Prova amanhã");
        await handlerGeneric(msgGeneric);
        assert.deepEqual(msgGeneric.replies, [GENERIC_ERROR_MESSAGE]);
    });
});

describe("app.js - startApplication", () => {
    it("executa fluxo normal na ordem initDb -> startServer -> startWhatsApp", async () => {
        const callOrder = [];
        const fakeServer = {
            close(cb) {
                cb();
            },
            closeIdleConnections() {},
        };
        const fakeWhatsAppClient = { destroy: async () => {} };

        const result = await startApplication({
            initDb: async () => {
                callOrder.push("initDb");
            },
            closeDb: async () => {
                callOrder.push("closeDb");
            },
            startServer: async () => {
                callOrder.push("startServer");
                return fakeServer;
            },
            startWhatsApp: (_onMessage, options) => {
                callOrder.push("startWhatsApp");
                assert.equal(typeof options?.onInitError, "function");
                return fakeWhatsAppClient;
            },
        });

        assert.deepEqual(callOrder, ["initDb", "startServer", "startWhatsApp"]);
        assert.equal(result.httpServer, fakeServer);
        assert.equal(result.whatsappClient, fakeWhatsAppClient);
    });

    it("executa rollback síncrono (closeIdleConnections, close e closeDb) quando startWhatsApp lança erro", async () => {
        const events = [];
        const fakeServer = {
            close(cb) {
                events.push("server.close");
                cb();
            },
            closeIdleConnections() {
                events.push("server.closeIdleConnections");
            },
        };

        await assert.rejects(
            () =>
                startApplication({
                    initDb: async () => {
                        events.push("initDb");
                    },
                    closeDb: async () => {
                        events.push("closeDb");
                    },
                    startServer: async () => {
                        events.push("startServer");
                        return fakeServer;
                    },
                    startWhatsApp: () => {
                        events.push("startWhatsApp");
                        throw new Error("Falha ao subir WhatsApp");
                    },
                }),
            /Falha ao subir WhatsApp/
        );

        assert.deepEqual(events, [
            "initDb",
            "startServer",
            "startWhatsApp",
            "server.close",
            "server.closeIdleConnections",
            "closeDb",
        ]);
    });

    it("executa rollback assíncrono e aciona onWhatsAppInitError quando onInitError é disparado", async () => {
        const events = [];
        let capturedOnInitError = null;
        let receivedInitError = null;

        const fakeServer = {
            close(cb) {
                events.push("server.close");
                cb();
            },
            closeIdleConnections() {
                events.push("server.closeIdleConnections");
            },
        };

        await startApplication({
            initDb: async () => {
                events.push("initDb");
            },
            closeDb: async () => {
                events.push("closeDb");
            },
            startServer: async () => {
                events.push("startServer");
                return fakeServer;
            },
            startWhatsApp: (_onMessage, options) => {
                events.push("startWhatsApp");
                capturedOnInitError = options.onInitError;
                return { destroy: async () => {} };
            },
            onWhatsAppInitError: async (err) => {
                events.push("onWhatsAppInitError");
                receivedInitError = err;
            },
        });

        assert.equal(typeof capturedOnInitError, "function");

        const initFailure = new Error("Chromium não encontrado");
        await capturedOnInitError(initFailure);

        assert.equal(receivedInitError, initFailure);
        assert.deepEqual(events, [
            "initDb",
            "startServer",
            "startWhatsApp",
            "server.close",
            "server.closeIdleConnections",
            "closeDb",
            "onWhatsAppInitError",
        ]);
    });
});
