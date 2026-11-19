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
    const seqPrimaryWhatsappId = `test_db_seq_${runTag}@c.us`;
    const seqSecondaryWhatsappId = `test_db_seq_other_${runTag}@c.us`;
    const concurrentWhatsappId = `test_db_concurrent_${runTag}@c.us`;
    const httpRecompactWhatsappId = `test_db_http_recompact_${runTag}@c.us`;

    after(async () => {
        try {
            await repo.deleteUserAndTasks(primaryWhatsappId);
            await repo.deleteUserAndTasks(secondaryWhatsappId);
            await repo.deleteUserAndTasks(seqPrimaryWhatsappId);
            await repo.deleteUserAndTasks(seqSecondaryWhatsappId);
            await repo.deleteUserAndTasks(concurrentWhatsappId);
            await repo.deleteUserAndTasks(httpRecompactWhatsappId);
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

    it("mantém user_task_id sequencial denso (1..N) após apagar a última ou a primeira atividade e isola usuários", async () => {
        await initializeDatabase(testPool);

        // Cenário 1: cria [1, 2, 3], apaga 3 e cria nova -> deve assumir 3
        const p1 = await repo.createTask(seqPrimaryWhatsappId, {
            titulo: "Primary 1",
            tipo: "prova",
        });
        const p2 = await repo.createTask(seqPrimaryWhatsappId, {
            titulo: "Primary 2",
            tipo: "trabalho",
        });
        const p3 = await repo.createTask(seqPrimaryWhatsappId, {
            titulo: "Primary 3",
            tipo: "leitura",
        });
        const s1 = await repo.createTask(seqSecondaryWhatsappId, {
            titulo: "Secondary 1",
            tipo: "leitura",
        });

        assert.deepEqual(
            [p1.user_task_id, p2.user_task_id, p3.user_task_id],
            [1, 2, 3]
        );
        assert.equal(s1.user_task_id, 1);

        assert.equal(await repo.deleteUserTask(seqPrimaryWhatsappId, 3), true);
        assert.equal(await repo.deleteUserTask(seqPrimaryWhatsappId, 3), false);

        const pNewThird = await repo.createTask(seqPrimaryWhatsappId, {
            titulo: "Primary 3 Reutilizado",
            tipo: "exercicio",
        });
        assert.equal(pNewThird.user_task_id, 3);

        // Cenário 2: cria 4ª -> [1, 2, 3, 4] -> apaga 1 -> antiga 2 vira 1, 3 vira 2, 4 vira 3
        const p4 = await repo.createTask(seqPrimaryWhatsappId, {
            titulo: "Primary 4",
            tipo: "outro",
        });
        assert.equal(p4.user_task_id, 4);

        assert.equal(await repo.deleteUserTask(seqPrimaryWhatsappId, 1), true);

        const secondaryAfter = await repo.listTasks({
            whatsappId: seqSecondaryWhatsappId,
        });
        assert.equal(secondaryAfter.length, 1);
        assert.equal(secondaryAfter[0].user_task_id, 1);

        const primaryAfterDeleteFirst = await repo.listTasks({
            whatsappId: seqPrimaryWhatsappId,
        });
        assert.deepEqual(
            primaryAfterDeleteFirst.map((task) => ({
                id: task.id,
                user_task_id: task.user_task_id,
                titulo: task.titulo,
            })),
            [
                { id: p2.id, user_task_id: 1, titulo: "Primary 2" },
                { id: pNewThird.id, user_task_id: 2, titulo: "Primary 3 Reutilizado" },
                { id: p4.id, user_task_id: 3, titulo: "Primary 4" },
            ]
        );

        const reloadedSecond = await repo.getTaskById(p2.id, {
            whatsappId: seqPrimaryWhatsappId,
        });
        assert.equal(reloadedSecond?.user_task_id, 1);

        const updatedThird = await repo.updateTask(
            pNewThird.id,
            { titulo: "Primary 3 Atualizada" },
            { whatsappId: seqPrimaryWhatsappId }
        );
        assert.equal(updatedThird?.user_task_id, 2);

        const pNewFourth = await repo.createTask(seqPrimaryWhatsappId, {
            titulo: "Primary 4 Nova",
            tipo: "prova",
        });
        assert.equal(pNewFourth.user_task_id, 4);

        assert.equal(await repo.count(seqPrimaryWhatsappId), 4);
        assert.equal(await repo.count(seqSecondaryWhatsappId), 1);

        // listTasks() global sem filtro particiona user_task_id independentemente por usuário
        const allListed = await repo.listTasks();
        const primaryInGlobal = allListed.filter(
            (t) => t.whatsapp_id === seqPrimaryWhatsappId
        );
        const secondaryInGlobal = allListed.filter(
            (t) => t.whatsapp_id === seqSecondaryWhatsappId
        );
        assert.deepEqual(
            primaryInGlobal.map((t) => t.user_task_id),
            [1, 2, 3, 4]
        );
        assert.deepEqual(
            secondaryInGlobal.map((t) => t.user_task_id),
            [1]
        );

        // Exclusão de item intermediário (apaga ID 2 de [1,2,3,4] -> [1,2,3])
        assert.equal(await repo.deleteUserTask(seqPrimaryWhatsappId, 2), true);
        const afterMiddleDelete = await repo.listTasks({
            whatsappId: seqPrimaryWhatsappId,
        });
        assert.deepEqual(
            afterMiddleDelete.map((task) => ({
                user_task_id: task.user_task_id,
                titulo: task.titulo,
            })),
            [
                { user_task_id: 1, titulo: "Primary 2" },
                { user_task_id: 2, titulo: "Primary 4" },
                { user_task_id: 3, titulo: "Primary 4 Nova" },
            ]
        );
    });

    it("desempata por id ASC quando duas tarefas possuem exatamente o mesmo created_at", async () => {
        await initializeDatabase(testPool);

        const tieUser = `test_db_tie_${runTag}@c.us`;
        try {
            const {
                rows: [user],
            } = await testPool.query(
                `INSERT INTO users (whatsapp_id) VALUES ($1) RETURNING id`,
                [tieUser]
            );
            const fixedTimestamp = "2026-11-19T00:00:00.000Z";
            const {
                rows: [firstTie],
            } = await testPool.query(
                `INSERT INTO task (user_id, titulo, tipo, created_at)
                 VALUES ($1, $2, $3, $4)
                 RETURNING id`,
                [user.id, "Empate 1", "prova", fixedTimestamp]
            );
            const {
                rows: [secondTie],
            } = await testPool.query(
                `INSERT INTO task (user_id, titulo, tipo, created_at)
                 VALUES ($1, $2, $3, $4)
                 RETURNING id`,
                [user.id, "Empate 2", "trabalho", fixedTimestamp]
            );
            assert.ok(firstTie.id < secondTie.id);

            const listed = await repo.listTasks({ whatsappId: tieUser });
            assert.deepEqual(
                listed.map((t) => ({ id: t.id, user_task_id: t.user_task_id })),
                [
                    { id: firstTie.id, user_task_id: 1 },
                    { id: secondTie.id, user_task_id: 2 },
                ]
            );

            assert.equal(await repo.deleteUserTask(tieUser, 1), true);
            const afterDelete = await repo.listTasks({ whatsappId: tieUser });
            assert.deepEqual(
                afterDelete.map((t) => ({
                    id: t.id,
                    user_task_id: t.user_task_id,
                })),
                [{ id: secondTie.id, user_task_id: 1 }]
            );
        } finally {
            await repo.deleteUserAndTasks(tieUser);
        }
    });

    it("retorna null/false em getTaskById, updateTask e deleteTask para IDs fora do intervalo PostgreSQL", async () => {
        assert.equal(await repo.getTaskById(0), null);
        assert.equal(await repo.getTaskById(2147483648), null);
        assert.equal(
            await repo.updateTask(0, { titulo: "X" }),
            null
        );
        assert.equal(await repo.deleteTask(-1), false);
        assert.equal(await repo.deleteTask(2147483648), false);
    });

    it("recompacta user_task_id automaticamente após exclusão via deleteTask (PK global HTTP)", async () => {
        await initializeDatabase(testPool);

        const t1 = await repo.createTask(httpRecompactWhatsappId, {
            titulo: "HTTP 1",
            tipo: "trabalho",
        });
        const t2 = await repo.createTask(httpRecompactWhatsappId, {
            titulo: "HTTP 2",
            tipo: "prova",
        });
        assert.equal(t1.user_task_id, 1);
        assert.equal(t2.user_task_id, 2);

        assert.equal(
            await repo.deleteTask(t1.id, { whatsappId: httpRecompactWhatsappId }),
            true
        );

        const remaining = await repo.listTasks({
            whatsappId: httpRecompactWhatsappId,
        });
        assert.deepEqual(
            remaining.map((task) => ({
                id: task.id,
                user_task_id: task.user_task_id,
            })),
            [{ id: t2.id, user_task_id: 1 }]
        );

        const tNext = await repo.createTask(httpRecompactWhatsappId, {
            titulo: "HTTP 2 Nova",
            tipo: "leitura",
        });
        assert.equal(tNext.user_task_id, 2);
    });

    it("mantém user_task_id único e sequencial sob criações concorrentes (Promise.all)", async () => {
        await initializeDatabase(testPool);

        const createdTasks = await Promise.all(
            Array.from({ length: 6 }, (_, index) =>
                repo.createTask(concurrentWhatsappId, {
                    titulo: `Concorrente ${index + 1}`,
                    tipo: "trabalho",
                })
            )
        );

        const returnedIds = createdTasks
            .map((task) => task.user_task_id)
            .sort((a, b) => a - b);
        assert.deepEqual(returnedIds, [1, 2, 3, 4, 5, 6]);

        const listedTasks = await repo.listTasks({
            whatsappId: concurrentWhatsappId,
        });
        assert.deepEqual(
            listedTasks.map((task) => task.user_task_id),
            [1, 2, 3, 4, 5, 6]
        );
    });

    it("initializeDatabase cria idx_task_user_created_id e remove índices obsoletos de forma idempotente", async () => {
        await initializeDatabase(testPool);
        await initializeDatabase(testPool);

        const { rows } = await testPool.query(
            `SELECT indexname
             FROM pg_indexes
             WHERE tablename = 'task'
               AND indexname IN ('idx_task_user_created_id', 'idx_task_user_task_id', 'idx_task_user_id')`
        );

        assert.deepEqual(
            rows.map((row) => row.indexname),
            ["idx_task_user_created_id"]
        );
    });
});
