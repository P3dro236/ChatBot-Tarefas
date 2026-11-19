import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
    checkDatabaseConnection,
    closePool,
    createPool,
    initializeDatabase,
} from "../../src/Server/PgConnect.js";
import { createTaskDbRepository } from "../../src/Repository/Task_Db_Repository.js";

describe("Integração Real - PostgreSQL e Task_Db_Repository", () => {
    const testPool = createPool();
    const repo = createTaskDbRepository(testPool);
    const runTag = `${Date.now()}_${randomUUID().slice(0, 8)}`;
    const primaryWhatsappId = `test_db_${runTag}@c.us`;
    const secondaryWhatsappId = `test_db_other_${runTag}@c.us`;

    after(async () => {
        try {
            await repo.deleteUserAndTasks(primaryWhatsappId);
            await repo.deleteUserAndTasks(secondaryWhatsappId);
        } finally {
            await closePool(testPool);
        }
    });

    it("valida conexão ativa e inicialização idempotente do schema", async () => {
        assert.equal(await checkDatabaseConnection(testPool), true);
        assert.equal(await initializeDatabase(testPool), true);
        assert.equal(await initializeDatabase(testPool), true);
    });

    it("executa CRUD completo com isolamento por usuário", async () => {
        const primaryTask = await repo.createTask(primaryWhatsappId, {
            titulo: "Prova de Estruturas de Dados",
            materia: "Estruturas de Dados",
            tipo: "prova",
            data_entrega: "2026-11-25",
            observacoes: "Árvores e grafos",
            nota: 15.5,
        });

        const secondaryTask = await repo.createTask(secondaryWhatsappId, {
            titulo: "Leitura de Artigo",
            materia: "Metodologia",
            tipo: "leitura",
            data_entrega: "2026-12-01",
            observacoes: null,
            nota: 0,
        });

        assert.ok(Number.isInteger(primaryTask.id) && primaryTask.id > 0);
        assert.equal(primaryTask.whatsapp_id, primaryWhatsappId);
        assert.equal(primaryTask.titulo, "Prova de Estruturas de Dados");
        assert.equal(primaryTask.materia, "Estruturas de Dados");
        assert.equal(primaryTask.tipo, "prova");
        assert.equal(primaryTask.data_entrega, "2026-11-25");
        assert.equal(primaryTask.observacoes, "Árvores e grafos");
        assert.equal(primaryTask.nota, 15.5);

        assert.equal(secondaryTask.nota, 0);

        const primaryList = await repo.listTasks({
            whatsappId: primaryWhatsappId,
        });
        assert.equal(primaryList.length, 1);
        assert.equal(primaryList[0].id, primaryTask.id);

        const secondaryList = await repo.listTasks({
            whatsappId: secondaryWhatsappId,
        });
        assert.equal(secondaryList.length, 1);
        assert.equal(secondaryList[0].id, secondaryTask.id);

        const foundByOwner = await repo.getTaskById(primaryTask.id, {
            whatsappId: primaryWhatsappId,
        });
        assert.equal(foundByOwner?.id, primaryTask.id);

        const hiddenFromOtherUser = await repo.getTaskById(primaryTask.id, {
            whatsappId: secondaryWhatsappId,
        });
        assert.equal(hiddenFromOtherUser, null);

        const blockedUpdate = await repo.updateTask(
            primaryTask.id,
            { titulo: "Tentativa Indevida" },
            { whatsappId: secondaryWhatsappId }
        );
        assert.equal(blockedUpdate, null);

        const updated = await repo.updateTask(
            primaryTask.id,
            {
                titulo: "Prova Final de Estruturas de Dados",
                nota: 20,
                observacoes: "Somente grafos",
            },
            { whatsappId: primaryWhatsappId }
        );
        assert.equal(updated?.titulo, "Prova Final de Estruturas de Dados");
        assert.equal(updated?.nota, 20);
        assert.equal(updated?.observacoes, "Somente grafos");
        assert.equal(updated?.data_entrega, "2026-11-25");

        const reloaded = await repo.getTaskById(primaryTask.id);
        assert.equal(reloaded?.titulo, "Prova Final de Estruturas de Dados");
        assert.equal(reloaded?.nota, 20);

        const blockedDelete = await repo.deleteTask(primaryTask.id, {
            whatsappId: secondaryWhatsappId,
        });
        assert.equal(blockedDelete, false);

        const deleted = await repo.deleteTask(primaryTask.id, {
            whatsappId: primaryWhatsappId,
        });
        assert.equal(deleted, true);

        const afterDelete = await repo.getTaskById(primaryTask.id);
        assert.equal(afterDelete, null);

        const deletedAgain = await repo.deleteTask(primaryTask.id, {
            whatsappId: primaryWhatsappId,
        });
        assert.equal(deletedAgain, false);
    });
});
