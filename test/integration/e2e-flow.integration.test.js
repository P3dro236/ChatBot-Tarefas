import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { getEnv } from "../../src/config/env.js";
import {
    closePool,
    createPool,
    initializeDatabase,
} from "../../src/Server/PgConnect.js";
import { startHttpServer } from "../../src/Server/Server.js";
import { createTaskDbRepository } from "../../src/Repository/Task_Db_Repository.js";
import { testTaskStorage } from "../../src/Repository/Task_Repository.js";
import {
    conversationMemory,
    EMPTY_TASKS_MESSAGE,
    formatTaskDeletedMessage,
    TASK_SAVED_MESSAGE,
    TEST_STORAGE_CLEARED_MESSAGE,
    UNAUTHORIZED_ADMIN_COMMAND_MESSAGE,
} from "../../src/Repository/Messages_Repository.js";

function closeHttpServer(server) {
    if (!server) {
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeIdleConnections?.();
    });
}

describe("Integração E2E Real - HTTP Express + Gemini + PostgreSQL", () => {
    const testPool = createPool();
    const repo = createTaskDbRepository(testPool);
    const runTag = `${Date.now()}_${randomUUID().slice(0, 8)}`;

    const cmdWhatsappId = `test_e2e_cmd_${runTag}@c.us`;
    const emptyWhatsappId = `test_e2e_empty_${runTag}@c.us`;
    const geminiWhatsappId = `test_e2e_gemini_${runTag}@c.us`;
    const memoryWhatsappId = `test_e2e_memory_${runTag}@c.us`;
    const unauthWhatsappId = `test_e2e_unauth_${runTag}@c.us`;
    const unauthGroupId = `test_e2e_group_${runTag}@g.us`;
    const crudWhatsappId = `test_e2e_crud_${runTag}@c.us`;
    const aliasWhatsappId = `test_e2e_alias_${runTag}@c.us`;
    const ownerWhatsappId = `test_e2e_owner_${runTag}@c.us`;
    const otherWhatsappId = `test_e2e_other_${runTag}@c.us`;

    const createdWhatsappIds = [
        cmdWhatsappId,
        emptyWhatsappId,
        geminiWhatsappId,
        memoryWhatsappId,
        unauthWhatsappId,
        unauthGroupId,
        crudWhatsappId,
        aliasWhatsappId,
        ownerWhatsappId,
        otherWhatsappId,
    ];

    let server = null;
    let baseUrl = "";

    before(async () => {
        await initializeDatabase(testPool);
        server = await startHttpServer({
            port: 0,
            host: "127.0.0.1",
            dbPool: testPool,
        });
        const address = server.address();
        baseUrl = `http://127.0.0.1:${address.port}`;
    });

    after(async () => {
        testTaskStorage.clear();
        conversationMemory.clearHistory();
        try {
            await closeHttpServer(server);
        } finally {
            try {
                for (const whatsappId of createdWhatsappIds) {
                    await repo.deleteUserAndTasks(whatsappId);
                }
            } finally {
                await closePool(testPool);
            }
        }
    });

    it("GET /health retorna 200 com banco conectado e omite header x-powered-by", async () => {
        const res = await fetch(`${baseUrl}/health`);
        const body = await res.json();

        assert.equal(res.status, 200);
        assert.deepEqual(body, { status: "ok", database: "connected" });
        assert.equal(res.headers.get("x-powered-by"), null);
    });

    it("GET /health retorna 503 quando o banco falha e omite header x-powered-by", async (t) => {
        t.mock.method(console, "error", () => {});

        const failingPool = {
            async query() {
                throw new Error("db down");
            },
        };

        const failingServer = await startHttpServer({
            port: 0,
            host: "127.0.0.1",
            dbPool: failingPool,
        });

        try {
            const { port } = failingServer.address();
            const res = await fetch(`http://127.0.0.1:${port}/health`);
            const body = await res.json();

            assert.equal(res.status, 503);
            assert.deepEqual(body, {
                status: "error",
                database: "disconnected",
            });
            assert.equal(res.headers.get("x-powered-by"), null);
        } finally {
            await closeHttpServer(failingServer);
        }
    });

    it("POST /message trata comandos, alias { user, message }, 'todas' vazio e payloads inválidos (400)", async () => {
        const cmdRes = await fetch(`${baseUrl}/message`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ from: cmdWhatsappId, body: "comandos" }),
        });
        const cmdBody = await cmdRes.json();

        assert.equal(cmdRes.status, 200);
        assert.equal(cmdBody.from, cmdWhatsappId);
        assert.equal(cmdBody.replies.length, 1);
        assert.ok(cmdBody.replies[0].includes("Lista de comandos:"));

        const aliasRes = await fetch(`${baseUrl}/message`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ user: cmdWhatsappId, message: "comandos" }),
        });
        const aliasBody = await aliasRes.json();

        assert.equal(aliasRes.status, 200);
        assert.equal(aliasBody.from, cmdWhatsappId);
        assert.equal(aliasBody.replies.length, 1);
        assert.ok(aliasBody.replies[0].includes("Lista de comandos:"));

        const emptyTasksRes = await fetch(`${baseUrl}/message`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ from: emptyWhatsappId, body: "todas" }),
        });
        const emptyTasksBody = await emptyTasksRes.json();

        assert.equal(emptyTasksRes.status, 200);
        assert.deepEqual(emptyTasksBody.replies, [EMPTY_TASKS_MESSAGE]);

        const invalidPayloads = [
            {},
            { body: "   " },
            { from: cmdWhatsappId, body: "comandos", campo_extra: true },
        ];

        for (const payload of invalidPayloads) {
            const res = await fetch(`${baseUrl}/message`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(payload),
            });
            assert.equal(res.status, 400);
        }
    });

    it(
        "POST /message cria tarefas via Gemini real (com *ID* e omissão de vazios), lista consolidada em 'todas' e apaga por ID",
        { timeout: 90_000 },
        async () => {
            const firstCreateRes = await fetch(`${baseUrl}/message`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    from: geminiWhatsappId,
                    body: "Trabalho de Banco de Dados para entregar dia 25/11/2026",
                }),
            });
            const firstCreateBody = await firstCreateRes.json();

            assert.equal(firstCreateRes.status, 200);
            assert.equal(firstCreateBody.from, geminiWhatsappId);
            assert.equal(firstCreateBody.replies.length, 2);
            assert.equal(firstCreateBody.replies[0], TASK_SAVED_MESSAGE);
            assert.ok(firstCreateBody.replies[1].includes("*ID*: 1"));
            assert.ok(firstCreateBody.replies[1].includes("*Titulo*:"));
            assert.ok(
                firstCreateBody.replies[1].includes("*Data* de entrega: 25/11")
            );
            assert.equal(firstCreateBody.replies[1].includes("*Nota*:"), false);
            assert.equal(
                firstCreateBody.replies[1].includes("Não informada"),
                false
            );

            const secondCreateRes = await fetch(`${baseUrl}/message`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    from: geminiWhatsappId,
                    body: "Prova de Redes dia 30/11/2026 valendo 20 pontos",
                }),
            });
            const secondCreateBody = await secondCreateRes.json();

            assert.equal(secondCreateRes.status, 200);
            assert.equal(secondCreateBody.replies.length, 2);
            assert.equal(secondCreateBody.replies[0], TASK_SAVED_MESSAGE);
            assert.ok(secondCreateBody.replies[1].includes("*ID*: 2"));
            assert.ok(secondCreateBody.replies[1].includes("*Nota*: 20"));
            assert.ok(
                secondCreateBody.replies[1].includes("*Data* de entrega: 30/11")
            );

            const listRes = await fetch(`${baseUrl}/message`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ from: geminiWhatsappId, body: "todas" }),
            });
            const listBody = await listRes.json();

            assert.equal(listRes.status, 200);
            assert.equal(listBody.replies.length, 1);
            assert.ok(listBody.replies[0].includes("*ID*: 1"));
            assert.ok(listBody.replies[0].includes("*ID*: 2"));
            assert.ok(listBody.replies[0].includes("*Nota*: 20"));
            assert.ok(
                listBody.replies[0].includes("*Data* de entrega: 25/11")
            );
            assert.ok(
                listBody.replies[0].includes("*Data* de entrega: 30/11")
            );

            const deleteFirstRes = await fetch(`${baseUrl}/message`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    from: geminiWhatsappId,
                    body: "apagar 1",
                }),
            });
            const deleteFirstBody = await deleteFirstRes.json();

            assert.equal(deleteFirstRes.status, 200);
            assert.deepEqual(deleteFirstBody.replies, [
                formatTaskDeletedMessage(1, 1),
            ]);

            const encodedGeminiUser = encodeURIComponent(geminiWhatsappId);
            const remainingRes = await fetch(
                `${baseUrl}/task?whatsapp_id=${encodedGeminiUser}`
            );
            const remainingTasks = await remainingRes.json();

            assert.equal(remainingRes.status, 200);
            assert.equal(remainingTasks.length, 1);
            assert.equal(remainingTasks[0].user_task_id, 1);

            const listReindexedRes = await fetch(`${baseUrl}/message`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ from: geminiWhatsappId, body: "todas" }),
            });
            const listReindexedBody = await listReindexedRes.json();

            assert.equal(listReindexedRes.status, 200);
            assert.equal(listReindexedBody.replies.length, 1);
            assert.ok(listReindexedBody.replies[0].includes("*ID*: 1"));
            assert.ok(listReindexedBody.replies[0].includes("*Nota*: 20"));
            assert.ok(listReindexedBody.replies[0].includes("30/11"));
            assert.ok(!listReindexedBody.replies[0].includes("*ID*: 2"));

            const deleteSecondRes = await fetch(`${baseUrl}/message`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    from: geminiWhatsappId,
                    body: "apagar 1",
                }),
            });
            const deleteSecondBody = await deleteSecondRes.json();

            assert.equal(deleteSecondRes.status, 200);
            assert.deepEqual(deleteSecondBody.replies, [
                formatTaskDeletedMessage(1, 0),
            ]);

            const emptyAfterDeleteRes = await fetch(`${baseUrl}/message`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ from: geminiWhatsappId, body: "todas" }),
            });
            const emptyAfterDeleteBody = await emptyAfterDeleteRes.json();

            assert.equal(emptyAfterDeleteRes.status, 200);
            assert.deepEqual(emptyAfterDeleteBody.replies, [
                EMPTY_TASKS_MESSAGE,
            ]);
        }
    );

    it(
        "POST /message preserva memória de conversa multi-turno com Gemini real e persiste ao completar no PostgreSQL",
        { timeout: 90_000 },
        async () => {
            const encodedMemoryUser = encodeURIComponent(memoryWhatsappId);
            conversationMemory.clearHistory(memoryWhatsappId);

            try {
                const step1Res = await fetch(`${baseUrl}/message`, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                        from: memoryWhatsappId,
                        body: "Prova amanhã",
                    }),
                });
                const step1Body = await step1Res.json();

                assert.equal(step1Res.status, 200);
                assert.equal(step1Body.replies.length, 1);
                assert.equal(typeof step1Body.replies[0], "string");
                assert.ok(step1Body.replies[0].trim().length > 0);
                assert.notEqual(step1Body.replies[0], TASK_SAVED_MESSAGE);

                const tasksBeforeCompletionRes = await fetch(
                    `${baseUrl}/task?whatsapp_id=${encodedMemoryUser}`
                );
                const tasksBeforeCompletion =
                    await tasksBeforeCompletionRes.json();
                assert.equal(tasksBeforeCompletionRes.status, 200);
                assert.deepEqual(tasksBeforeCompletion, []);

                const step2Res = await fetch(`${baseUrl}/message`, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                        from: memoryWhatsappId,
                        body: "A matéria é História e vale 10 pontos",
                    }),
                });
                const step2Body = await step2Res.json();

                assert.equal(step2Res.status, 200);
                assert.equal(step2Body.replies.length, 2);
                assert.equal(step2Body.replies[0], TASK_SAVED_MESSAGE);
                assert.ok(step2Body.replies[1].includes("*ID*: 1"));
                assert.ok(step2Body.replies[1].includes("*Nota*: 10"));

                const tasksAfterCompletionRes = await fetch(
                    `${baseUrl}/task?whatsapp_id=${encodedMemoryUser}`
                );
                const tasksAfterCompletion =
                    await tasksAfterCompletionRes.json();

                assert.equal(tasksAfterCompletionRes.status, 200);
                assert.equal(tasksAfterCompletion.length, 1);
                assert.equal(tasksAfterCompletion[0].user_task_id, 1);
                assert.equal(tasksAfterCompletion[0].nota, 10);
                assert.equal(tasksAfterCompletion[0].tipo, "prova");
                assert.match(
                    tasksAfterCompletion[0].materia ?? "",
                    /hist[oó]ria/i
                );
                assert.deepEqual(
                    conversationMemory.getHistory(memoryWhatsappId),
                    []
                );
            } finally {
                conversationMemory.clearHistory(memoryWhatsappId);
            }
        }
    );

    it(
        "POST /message bloqueia /teste e /teste-limpar para não autorizados e executa simulação isolada para ADMIN_TEST_NUMBER",
        { timeout: 90_000 },
        async (t) => {
            const unauthTestRes = await fetch(`${baseUrl}/message`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    from: unauthWhatsappId,
                    body: "/teste",
                }),
            });
            const unauthTestBody = await unauthTestRes.json();
            assert.equal(unauthTestRes.status, 200);
            assert.deepEqual(unauthTestBody.replies, [
                UNAUTHORIZED_ADMIN_COMMAND_MESSAGE,
            ]);

            const unauthClearRes = await fetch(`${baseUrl}/message`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    from: unauthWhatsappId,
                    body: "/teste-limpar",
                }),
            });
            const unauthClearBody = await unauthClearRes.json();
            assert.equal(unauthClearRes.status, 200);
            assert.deepEqual(unauthClearBody.replies, [
                UNAUTHORIZED_ADMIN_COMMAND_MESSAGE,
            ]);

            const groupTestRes = await fetch(`${baseUrl}/message`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    from: unauthGroupId,
                    body: "/teste",
                }),
            });
            const groupTestBody = await groupTestRes.json();
            assert.equal(groupTestRes.status, 200);
            assert.deepEqual(groupTestBody.replies, [
                UNAUTHORIZED_ADMIN_COMMAND_MESSAGE,
            ]);

            const configuredAdmin = getEnv().ADMIN_TEST_NUMBER;
            await t.test(
                "executa /teste e /teste-limpar isolados com Gemini real quando ADMIN_TEST_NUMBER está definido",
                {
                    skip: !configuredAdmin
                        ? "ADMIN_TEST_NUMBER não configurado"
                        : false,
                    timeout: 90_000,
                },
                async () => {
                    const adminWhatsappId = configuredAdmin.includes("@")
                        ? configuredAdmin
                        : `${configuredAdmin}@c.us`;
                    const adminGroupId = `${adminWhatsappId.split("@")[0]}@g.us`;

                    const adminGroupRes = await fetch(`${baseUrl}/message`, {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({
                            from: adminGroupId,
                            body: "/teste",
                        }),
                    });
                    const adminGroupBody = await adminGroupRes.json();
                    assert.equal(adminGroupRes.status, 200);
                    assert.deepEqual(adminGroupBody.replies, [
                        UNAUTHORIZED_ADMIN_COMMAND_MESSAGE,
                    ]);

                    testTaskStorage.clear();
                    const beforeAdminTasks = await repo.listTasks({
                        whatsappId: adminWhatsappId,
                    });

                    try {
                        const adminTestRes = await fetch(`${baseUrl}/message`, {
                            method: "POST",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({
                                from: adminWhatsappId,
                                body: "/teste",
                            }),
                        });
                        const adminTestBody = await adminTestRes.json();

                        assert.equal(adminTestRes.status, 200);
                        assert.equal(adminTestBody.replies.length, 1);
                        assert.ok(
                            adminTestBody.replies[0].includes(
                                "Modo Teste Isolado"
                            )
                        );
                        assert.ok(
                            adminTestBody.replies[0].includes("Simulação 1")
                        );
                        assert.ok(
                            adminTestBody.replies[0].includes("Simulação 2")
                        );
                        assert.ok(
                            adminTestBody.replies[0].includes(
                                "Total no storage de teste:"
                            )
                        );
                        assert.ok(testTaskStorage.count(adminWhatsappId) > 0);

                        const afterAdminTasks = await repo.listTasks({
                            whatsappId: adminWhatsappId,
                        });
                        assert.equal(
                            afterAdminTasks.length,
                            beforeAdminTasks.length
                        );

                        const adminClearRes = await fetch(
                            `${baseUrl}/message`,
                            {
                                method: "POST",
                                headers: { "content-type": "application/json" },
                                body: JSON.stringify({
                                    from: adminWhatsappId,
                                    body: "/teste-limpar",
                                }),
                            }
                        );
                        const adminClearBody = await adminClearRes.json();

                        assert.equal(adminClearRes.status, 200);
                        assert.deepEqual(adminClearBody.replies, [
                            TEST_STORAGE_CLEARED_MESSAGE,
                        ]);
                        assert.equal(
                            testTaskStorage.count(adminWhatsappId),
                            0
                        );
                        assert.equal(testTaskStorage.count(), 0);
                    } finally {
                        testTaskStorage.clear();
                        conversationMemory.clearHistory(adminWhatsappId);
                    }
                }
            );
        }
    );

    it("CRUD HTTP /task completo via POST /task (201) e alias user, desacoplado do Gemini", async () => {
        const createRes = await fetch(`${baseUrl}/task`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                whatsapp_id: crudWhatsappId,
                titulo: "Trabalho de Engenharia de Software",
                materia: "Engenharia de Software",
                tipo: "trabalho",
                data_entrega: "2026-11-28",
                observacoes: "Entrega em grupo de 3",
                nota: 18.5,
            }),
        });
        const created = await createRes.json();

        assert.equal(createRes.status, 201);
        assert.ok(Number.isInteger(created.id) && created.id > 0);
        assert.equal(created.whatsapp_id, crudWhatsappId);
        assert.equal(created.titulo, "Trabalho de Engenharia de Software");
        assert.equal(created.materia, "Engenharia de Software");
        assert.equal(created.tipo, "trabalho");
        assert.equal(created.data_entrega, "2026-11-28");
        assert.equal(created.observacoes, "Entrega em grupo de 3");
        assert.equal(created.nota, 18.5);

        const aliasCreateRes = await fetch(`${baseUrl}/task`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                user: aliasWhatsappId,
                titulo: "Leitura de Clean Code",
                materia: "Arquitetura",
                tipo: "leitura",
                data_entrega: "2026-12-03",
                observacoes: "Capítulos 1 a 3",
                nota: 5,
            }),
        });
        const aliasCreated = await aliasCreateRes.json();

        assert.equal(aliasCreateRes.status, 201);
        assert.equal(aliasCreated.whatsapp_id, aliasWhatsappId);
        assert.equal(aliasCreated.titulo, "Leitura de Clean Code");

        const encodedCrudUser = encodeURIComponent(crudWhatsappId);
        const encodedAliasUser = encodeURIComponent(aliasWhatsappId);

        const listByWhatsappIdRes = await fetch(
            `${baseUrl}/task?whatsapp_id=${encodedCrudUser}`
        );
        const listByWhatsappId = await listByWhatsappIdRes.json();

        assert.equal(listByWhatsappIdRes.status, 200);
        assert.equal(listByWhatsappId.length, 1);
        assert.equal(listByWhatsappId[0].id, created.id);

        const listByUserAliasRes = await fetch(
            `${baseUrl}/task?user=${encodedCrudUser}`
        );
        const listByUserAlias = await listByUserAliasRes.json();

        assert.equal(listByUserAliasRes.status, 200);
        assert.equal(listByUserAlias.length, 1);
        assert.equal(listByUserAlias[0].id, created.id);

        const aliasListRes = await fetch(
            `${baseUrl}/task?user=${encodedAliasUser}`
        );
        const aliasList = await aliasListRes.json();

        assert.equal(aliasListRes.status, 200);
        assert.equal(aliasList.length, 1);
        assert.equal(aliasList[0].id, aliasCreated.id);

        const getRes = await fetch(
            `${baseUrl}/task/${created.id}?whatsapp_id=${encodedCrudUser}`
        );
        const fetched = await getRes.json();

        assert.equal(getRes.status, 200);
        assert.equal(fetched.id, created.id);
        assert.equal(fetched.titulo, created.titulo);

        const patchRes = await fetch(
            `${baseUrl}/task/${created.id}?whatsapp_id=${encodedCrudUser}`,
            {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    titulo: "Trabalho de Engenharia de Software (Final)",
                    nota: 25,
                }),
            }
        );
        const patched = await patchRes.json();

        assert.equal(patchRes.status, 200);
        assert.equal(
            patched.titulo,
            "Trabalho de Engenharia de Software (Final)"
        );
        assert.equal(patched.nota, 25);

        const deleteRes = await fetch(
            `${baseUrl}/task/${created.id}?whatsapp_id=${encodedCrudUser}`,
            { method: "DELETE" }
        );
        const deleteBody = await deleteRes.json();

        assert.equal(deleteRes.status, 200);
        assert.deepEqual(deleteBody, { deleted: true, id: created.id });

        const afterDeleteRes = await fetch(
            `${baseUrl}/task/${created.id}?whatsapp_id=${encodedCrudUser}`
        );
        assert.equal(afterDeleteRes.status, 404);
    });

    it("garante isolamento cross-user (404) em GET, PATCH e DELETE /task/:id sem alterar a tarefa original", async () => {
        const createOwnerRes = await fetch(`${baseUrl}/task`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                whatsapp_id: ownerWhatsappId,
                titulo: "Prova Secreta do Dono",
                materia: "Segurança",
                tipo: "prova",
                data_entrega: "2026-12-10",
                nota: 30,
            }),
        });
        assert.equal(createOwnerRes.status, 201);
        const ownerTask = await createOwnerRes.json();

        const createOtherRes = await fetch(`${baseUrl}/task`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                whatsapp_id: otherWhatsappId,
                titulo: "Tarefa de Outro Usuário",
                tipo: "outro",
            }),
        });
        assert.equal(createOtherRes.status, 201);

        const encodedOwner = encodeURIComponent(ownerWhatsappId);
        const encodedOther = encodeURIComponent(otherWhatsappId);

        const crossGet = await fetch(
            `${baseUrl}/task/${ownerTask.id}?whatsapp_id=${encodedOther}`
        );
        assert.equal(crossGet.status, 404);

        const crossPatch = await fetch(
            `${baseUrl}/task/${ownerTask.id}?whatsapp_id=${encodedOther}`,
            {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    titulo: "Alteração Indevida",
                    nota: 0,
                }),
            }
        );
        assert.equal(crossPatch.status, 404);

        const crossDelete = await fetch(
            `${baseUrl}/task/${ownerTask.id}?whatsapp_id=${encodedOther}`,
            { method: "DELETE" }
        );
        assert.equal(crossDelete.status, 404);

        const verifyOwnerRes = await fetch(
            `${baseUrl}/task/${ownerTask.id}?whatsapp_id=${encodedOwner}`
        );
        const verifiedOwnerTask = await verifyOwnerRes.json();

        assert.equal(verifyOwnerRes.status, 200);
        assert.equal(verifiedOwnerTask.id, ownerTask.id);
        assert.equal(verifiedOwnerTask.titulo, "Prova Secreta do Dono");
        assert.equal(verifiedOwnerTask.nota, 30);
    });

    it("rejeita filtros de usuário vazios, inválidos ou divergentes com 400 (sem bypass)", async () => {
        const invalidGetPaths = [
            "/task?whatsapp_id=",
            "/task?whatsapp_id=%20",
            "/task?whatsapp_id=&user=pedro",
            "/task?whatsapp_id=a&user=b",
            "/task?whatsapp_id=a&whatsapp_id=b",
        ];

        for (const path of invalidGetPaths) {
            const res = await fetch(`${baseUrl}${path}`);
            assert.equal(
                res.status,
                400,
                `Esperado 400 para GET ${path}, recebido ${res.status}`
            );
        }

        const invalidDeleteRes = await fetch(
            `${baseUrl}/task/999999?whatsapp_id=%20`,
            { method: "DELETE" }
        );
        assert.equal(invalidDeleteRes.status, 400);
    });

    it("valida casos gerais de erro HTTP (400 e 404)", async () => {
        const invalidTaskRes = await fetch(`${baseUrl}/task`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                whatsapp_id: crudWhatsappId,
                titulo: "",
                tipo: "inexistente",
            }),
        });
        assert.equal(invalidTaskRes.status, 400);

        const extraFieldRes = await fetch(`${baseUrl}/task`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                whatsapp_id: crudWhatsappId,
                titulo: "Tarefa com campo extra",
                tipo: "trabalho",
                campo_extra: "nao_permitido",
            }),
        });
        assert.equal(extraFieldRes.status, 400);

        const badIdRes = await fetch(`${baseUrl}/task/abc`);
        assert.equal(badIdRes.status, 400);

        const emptyPatchRes = await fetch(`${baseUrl}/task/1`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({}),
        });
        assert.equal(emptyPatchRes.status, 400);

        const malformedJsonRes = await fetch(`${baseUrl}/task`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{json_malformado",
        });
        assert.equal(malformedJsonRes.status, 400);

        const notFoundRes = await fetch(`${baseUrl}/rota-inexistente`);
        assert.equal(notFoundRes.status, 404);
    });
});
