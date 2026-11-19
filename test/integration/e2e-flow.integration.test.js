import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
    closePool,
    createPool,
    initializeDatabase,
} from "../../src/Server/PgConnect.js";
import { startHttpServer } from "../../src/Server/Server.js";
import { createTaskDbRepository } from "../../src/Repository/Task_Db_Repository.js";
import {
    EMPTY_TASKS_MESSAGE,
    TASK_SAVED_MESSAGE,
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
    const crudWhatsappId = `test_e2e_crud_${runTag}@c.us`;
    const aliasWhatsappId = `test_e2e_alias_${runTag}@c.us`;
    const ownerWhatsappId = `test_e2e_owner_${runTag}@c.us`;
    const otherWhatsappId = `test_e2e_other_${runTag}@c.us`;

    const createdWhatsappIds = [
        cmdWhatsappId,
        emptyWhatsappId,
        geminiWhatsappId,
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
        "POST /message cria tarefa via Gemini real, persiste no PostgreSQL e lista em 'todas'",
        { timeout: 60_000 },
        async () => {
            const createRes = await fetch(`${baseUrl}/message`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    from: geminiWhatsappId,
                    body: "Trabalho de Banco de Dados para entregar dia 25/11/2026 valendo 20 pontos",
                }),
            });
            const createBody = await createRes.json();

            assert.equal(createRes.status, 200);
            assert.equal(createBody.from, geminiWhatsappId);
            assert.equal(createBody.replies.length, 2);
            assert.equal(createBody.replies[0], TASK_SAVED_MESSAGE);
            assert.ok(createBody.replies[1].includes("*Titulo*:"));
            assert.ok(createBody.replies[1].includes("*Nota*: 20"));
            assert.ok(createBody.replies[1].includes("*Data* de entrega: 25/11"));

            const listRes = await fetch(`${baseUrl}/message`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ from: geminiWhatsappId, body: "todas" }),
            });
            const listBody = await listRes.json();

            assert.equal(listRes.status, 200);
            assert.equal(listBody.replies.length, 1);
            assert.ok(listBody.replies[0].includes("*Nota*: 20"));
            assert.ok(listBody.replies[0].includes("*Data* de entrega: 25/11"));
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
