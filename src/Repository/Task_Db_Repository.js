import { getPool } from "../Server/PgConnect.js";

const MAX_POSTGRES_INT = 2147483647;

const UPDATABLE_COLUMNS = Object.freeze([
    "titulo",
    "materia",
    "tipo",
    "data_entrega",
    "observacoes",
    "nota"
]);

const TASK_BASE_FIELDS = `
    t.id,
    t.user_id,
    u.whatsapp_id,
    t.titulo,
    t.materia,
    t.tipo,
    TO_CHAR(t.data_entrega, 'YYYY-MM-DD') AS data_entrega,
    t.observacoes,
    t.nota,
    t.created_at
`;

const USER_TASK_ID_SUBQUERY = `
    (
        SELECT COUNT(*)::int
        FROM task t2
        WHERE t2.user_id = t.user_id
          AND (t2.created_at, t2.id) <= (t.created_at, t.id)
    ) AS user_task_id
`;

function normalizeWhatsappId(whatsappId) {
    if (typeof whatsappId !== "string" || whatsappId.trim().length === 0) {
        throw new Error("whatsappId deve ser uma string não vazia.");
    }

    return whatsappId.trim();
}

function normalizeOptionalWhatsappId(whatsappId) {
    if (whatsappId === undefined || whatsappId === null) {
        return null;
    }

    return normalizeWhatsappId(whatsappId);
}

function isValidPositivePostgresInt(value) {
    return Number.isInteger(value) && value >= 1 && value <= MAX_POSTGRES_INT;
}

export function formatTaskRow(row) {
    if (!row) {
        return null;
    }

    return {
        id: row.id,
        user_id: row.user_id,
        user_task_id: row.user_task_id ?? null,
        whatsapp_id: row.whatsapp_id,
        titulo: row.titulo,
        materia: row.materia ?? null,
        tipo: row.tipo,
        data_entrega: row.data_entrega ?? null,
        observacoes: row.observacoes ?? null,
        nota: row.nota === null || row.nota === undefined ? null : Number(row.nota),
        created_at: row.created_at
    };
}

export function createTaskDbRepository(dbPool) {
    const resolvePool = () => dbPool ?? getPool();

    async function findOrCreateUser(whatsappId) {
        const normalizedWhatsappId = normalizeWhatsappId(whatsappId);

        const { rows } = await resolvePool().query(
            `INSERT INTO users (whatsapp_id)
             VALUES ($1)
             ON CONFLICT (whatsapp_id) DO UPDATE SET whatsapp_id = EXCLUDED.whatsapp_id
             RETURNING id, whatsapp_id, created_at`,
            [normalizedWhatsappId]
        );

        return rows[0];
    }

    async function createTask(whatsappId, taskData) {
        const normalizedWhatsappId = normalizeWhatsappId(whatsappId);

        if (!taskData || typeof taskData !== "object" || Array.isArray(taskData)) {
            throw new Error("Dados da tarefa inválidos.");
        }

        const client = await resolvePool().connect();

        try {
            await client.query("BEGIN");

            // Serializa criações concorrentes do mesmo usuário na linha de users
            const { rows: userRows } = await client.query(
                `INSERT INTO users (whatsapp_id)
                 VALUES ($1)
                 ON CONFLICT (whatsapp_id) DO UPDATE SET whatsapp_id = EXCLUDED.whatsapp_id
                 RETURNING id, whatsapp_id`,
                [normalizedWhatsappId]
            );
            const user = userRows[0];

            const { rows: insertedRows } = await client.query(
                `INSERT INTO task (user_id, titulo, materia, tipo, data_entrega, observacoes, nota, created_at)
                 VALUES (
                     $1, $2, $3, $4, $5, $6, $7,
                     GREATEST(
                         clock_timestamp(),
                         COALESCE(
                             (SELECT MAX(created_at) FROM task WHERE user_id = $1),
                             clock_timestamp()
                         )
                     )
                 )
                 RETURNING
                     id,
                     user_id,
                     titulo,
                     materia,
                     tipo,
                     TO_CHAR(data_entrega, 'YYYY-MM-DD') AS data_entrega,
                     observacoes,
                     nota,
                     created_at`,
                [
                    user.id,
                    taskData.titulo,
                    taskData.materia ?? null,
                    taskData.tipo,
                    taskData.data_entrega ?? null,
                    taskData.observacoes ?? null,
                    taskData.nota ?? null
                ]
            );
            const inserted = insertedRows[0];

            const { rows: positionRows } = await client.query(
                `SELECT COUNT(*)::int AS user_task_id
                 FROM task t
                 INNER JOIN task self ON self.id = $2
                 WHERE t.user_id = $1
                   AND (t.created_at, t.id) <= (self.created_at, self.id)`,
                [user.id, inserted.id]
            );

            await client.query("COMMIT");

            return formatTaskRow({
                ...inserted,
                whatsapp_id: user.whatsapp_id,
                user_task_id: positionRows[0]?.user_task_id ?? 1
            });
        } catch (err) {
            await client.query("ROLLBACK").catch(() => {});
            throw err;
        } finally {
            client.release();
        }
    }

    async function listTasks({ whatsappId } = {}) {
        const normalizedWhatsappId = normalizeOptionalWhatsappId(whatsappId);
        const params = [];
        const conditions = [];

        if (normalizedWhatsappId) {
            params.push(normalizedWhatsappId);
            conditions.push(`u.whatsapp_id = $${params.length}`);
        }

        const whereClause =
            conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

        const { rows } = await resolvePool().query(
            `SELECT
                 ${TASK_BASE_FIELDS},
                 ROW_NUMBER() OVER (
                     PARTITION BY t.user_id
                     ORDER BY t.created_at ASC, t.id ASC
                 )::int AS user_task_id
             FROM task t
             INNER JOIN users u ON u.id = t.user_id
             ${whereClause}
             ORDER BY t.created_at ASC, t.id ASC`,
            params
        );

        return rows.map(formatTaskRow);
    }

    async function getTaskById(id, { whatsappId } = {}) {
        const normalizedWhatsappId = normalizeOptionalWhatsappId(whatsappId);
        if (!isValidPositivePostgresInt(id)) {
            return null;
        }

        const params = [id];
        const conditions = ["t.id = $1"];

        if (normalizedWhatsappId) {
            params.push(normalizedWhatsappId);
            conditions.push(`u.whatsapp_id = $${params.length}`);
        }

        const { rows } = await resolvePool().query(
            `SELECT ${TASK_BASE_FIELDS}, ${USER_TASK_ID_SUBQUERY}
             FROM task t
             INNER JOIN users u ON u.id = t.user_id
             WHERE ${conditions.join(" AND ")}`,
            params
        );

        return rows[0] ? formatTaskRow(rows[0]) : null;
    }

    async function updateTask(id, updates, { whatsappId } = {}) {
        if (!updates || typeof updates !== "object") {
            throw new Error("Nenhum campo válido informado para atualização.");
        }

        const setClauses = [];
        const values = [];

        for (const column of UPDATABLE_COLUMNS) {
            if (Object.hasOwn(updates, column) && updates[column] !== undefined) {
                values.push(updates[column]);
                setClauses.push(`${column} = $${values.length}`);
            }
        }

        if (setClauses.length === 0) {
            throw new Error("Nenhum campo válido informado para atualização.");
        }

        const normalizedWhatsappId = normalizeOptionalWhatsappId(whatsappId);
        if (!isValidPositivePostgresInt(id)) {
            return null;
        }

        values.push(id);
        const whereConditions = ["t.user_id = u.id", `t.id = $${values.length}`];

        if (normalizedWhatsappId) {
            values.push(normalizedWhatsappId);
            whereConditions.push(`u.whatsapp_id = $${values.length}`);
        }

        const { rows } = await resolvePool().query(
            `UPDATE task t
             SET ${setClauses.join(", ")}
             FROM users u
             WHERE ${whereConditions.join(" AND ")}
             RETURNING ${TASK_BASE_FIELDS}, ${USER_TASK_ID_SUBQUERY}`,
            values
        );

        return rows[0] ? formatTaskRow(rows[0]) : null;
    }

    async function deleteTask(id, { whatsappId } = {}) {
        const normalizedWhatsappId = normalizeOptionalWhatsappId(whatsappId);
        if (!isValidPositivePostgresInt(id)) {
            return false;
        }

        if (normalizedWhatsappId) {
            const result = await resolvePool().query(
                `DELETE FROM task t
                 USING users u
                 WHERE t.user_id = u.id
                   AND t.id = $1
                   AND u.whatsapp_id = $2`,
                [id, normalizedWhatsappId]
            );

            return (result.rowCount ?? 0) > 0;
        }

        const result = await resolvePool().query(
            `DELETE FROM task
             WHERE id = $1`,
            [id]
        );

        return (result.rowCount ?? 0) > 0;
    }

    async function deleteUserTask(whatsappId, userTaskId) {
        const normalizedWhatsappId = normalizeWhatsappId(whatsappId);

        if (!isValidPositivePostgresInt(userTaskId)) {
            return false;
        }

        const result = await resolvePool().query(
            `WITH ranked AS (
                 SELECT
                     t.id,
                     ROW_NUMBER() OVER (ORDER BY t.created_at ASC, t.id ASC) AS seq_id
                 FROM task t
                 INNER JOIN users u ON u.id = t.user_id
                 WHERE u.whatsapp_id = $1
             )
             DELETE FROM task
             WHERE id IN (SELECT id FROM ranked WHERE seq_id = $2)`,
            [normalizedWhatsappId, userTaskId]
        );

        return (result.rowCount ?? 0) > 0;
    }

    async function count(whatsappId) {
        const normalizedWhatsappId = normalizeOptionalWhatsappId(whatsappId);

        if (normalizedWhatsappId) {
            const { rows } = await resolvePool().query(
                `SELECT COUNT(*)::int AS total
                 FROM task t
                 INNER JOIN users u ON u.id = t.user_id
                 WHERE u.whatsapp_id = $1`,
                [normalizedWhatsappId]
            );

            return rows[0]?.total ?? 0;
        }

        const { rows } = await resolvePool().query(
            `SELECT COUNT(*)::int AS total FROM task`
        );

        return rows[0]?.total ?? 0;
    }

    async function deleteUserAndTasks(whatsappId) {
        const normalizedWhatsappId = normalizeWhatsappId(whatsappId);

        const result = await resolvePool().query(
            `DELETE FROM users
             WHERE whatsapp_id = $1`,
            [normalizedWhatsappId]
        );

        return (result.rowCount ?? 0) > 0;
    }

    return {
        findOrCreateUser,
        createTask,
        listTasks,
        getTaskById,
        updateTask,
        deleteTask,
        deleteUserTask,
        count,
        deleteUserAndTasks
    };
}

export const taskDbRepository = createTaskDbRepository();
