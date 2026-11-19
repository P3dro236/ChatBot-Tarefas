import express from "express";
import { z } from "zod";
import { getEnv } from "../config/env.js";
import { checkDatabaseConnection, getPool } from "./PgConnect.js";
import { createTaskDbRepository } from "../Repository/Task_Db_Repository.js";
import {
    createTaskBodySchema,
    updateTaskBodySchema
} from "../Repository/Task_Repository.js";
import { createMessageHandler } from "../Controller/Controller.js";

const DEFAULT_HTTP_USER_ID = "http_local";
const MAX_USER_ID_LENGTH = 100;
const MAX_POSTGRES_INT = 2147483647;

const messageBodySchema = z
    .object({
        from: z.string().trim().min(1).max(MAX_USER_ID_LENGTH).optional(),
        user: z.string().trim().min(1).max(MAX_USER_ID_LENGTH).optional(),
        body: z.string().trim().min(1).max(4000).optional(),
        message: z.string().trim().min(1).max(4000).optional()
    })
    .strict()
    .refine((data) => Boolean(data.body ?? data.message), {
        message: "Informe o campo 'body' ou 'message' com texto não vazio.",
        path: ["body"]
    });

function parsePositiveIntId(rawId) {
    if (typeof rawId !== "string" || !/^\d+$/.test(rawId)) {
        return null;
    }

    const parsed = Number(rawId);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_POSTGRES_INT) {
        return null;
    }

    return parsed;
}

function parseProvidedUserFilter(raw) {
    if (typeof raw !== "string") {
        return { value: undefined, error: "Parâmetro de usuário inválido." };
    }

    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_USER_ID_LENGTH) {
        return { value: undefined, error: "Parâmetro de usuário inválido." };
    }

    return { value: trimmed, error: null };
}

export function extractOptionalUserFilter(query) {
    if (!query || typeof query !== "object") {
        return { whatsappId: undefined, error: null };
    }

    const hasWhatsappId = Object.hasOwn(query, "whatsapp_id");
    const hasUser = Object.hasOwn(query, "user");

    if (!hasWhatsappId && !hasUser) {
        return { whatsappId: undefined, error: null };
    }

    const parsedWhatsappId = hasWhatsappId
        ? parseProvidedUserFilter(query.whatsapp_id)
        : null;
    if (parsedWhatsappId?.error) {
        return { whatsappId: undefined, error: parsedWhatsappId.error };
    }

    const parsedUser = hasUser ? parseProvidedUserFilter(query.user) : null;
    if (parsedUser?.error) {
        return { whatsappId: undefined, error: parsedUser.error };
    }

    if (
        parsedWhatsappId &&
        parsedUser &&
        parsedWhatsappId.value !== parsedUser.value
    ) {
        return {
            whatsappId: undefined,
            error: "Parâmetros whatsapp_id e user divergentes."
        };
    }

    return {
        whatsappId: parsedWhatsappId?.value ?? parsedUser?.value,
        error: null
    };
}

function parseTaskRouteParams(req) {
    const id = parsePositiveIntId(req.params.id);
    if (id === null) {
        return { id: null, whatsappId: undefined, error: "ID da tarefa inválido." };
    }

    const { whatsappId, error } = extractOptionalUserFilter(req.query);
    if (error) {
        return { id: null, whatsappId: undefined, error };
    }

    return { id, whatsappId, error: null };
}

function formatZodIssues(zodError) {
    return zodError.issues.map((issue) => ({
        field: issue.path.length > 0 ? issue.path.join(".") : "body",
        message: issue.message
    }));
}

export function createApp({ dbPool, taskRepository, handleMessage } = {}) {
    const resolvePool = () => dbPool ?? getPool();
    const resolvedRepository = taskRepository ?? createTaskDbRepository(dbPool);
    const messageHandler =
        handleMessage ?? createMessageHandler({ taskRepository: resolvedRepository });

    const app = express();
    app.disable("x-powered-by");
    app.use(express.json({ limit: "100kb" }));

    app.get("/health", async (req, res) => {
        try {
            await checkDatabaseConnection(resolvePool());
            return res.status(200).json({ status: "ok", database: "connected" });
        } catch (err) {
            console.error("Falha na verificação de saúde do banco:", err.message);
            return res.status(503).json({ status: "error", database: "disconnected" });
        }
    });

    app.get("/task", async (req, res, next) => {
        try {
            const { whatsappId, error } = extractOptionalUserFilter(req.query);
            if (error) {
                return res.status(400).json({ error });
            }

            const tasks = await resolvedRepository.listTasks({ whatsappId });
            return res.status(200).json(tasks);
        } catch (err) {
            return next(err);
        }
    });

    app.get("/task/:id", async (req, res, next) => {
        try {
            const { id, whatsappId, error } = parseTaskRouteParams(req);
            if (error) {
                return res.status(400).json({ error });
            }

            const task = await resolvedRepository.getTaskById(id, { whatsappId });
            if (!task) {
                return res.status(404).json({ error: "Tarefa não encontrada." });
            }

            return res.status(200).json(task);
        } catch (err) {
            return next(err);
        }
    });

    app.post("/task", async (req, res, next) => {
        try {
            const parsed = createTaskBodySchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({
                    error: "Dados da tarefa inválidos.",
                    details: formatZodIssues(parsed.error)
                });
            }

            const { whatsapp_id, user, ...taskData } = parsed.data;
            const whatsappId = whatsapp_id ?? user ?? DEFAULT_HTTP_USER_ID;

            const created = await resolvedRepository.createTask(whatsappId, taskData);
            return res.status(201).json(created);
        } catch (err) {
            return next(err);
        }
    });

    app.patch("/task/:id", async (req, res, next) => {
        try {
            const { id, whatsappId, error } = parseTaskRouteParams(req);
            if (error) {
                return res.status(400).json({ error });
            }

            const parsed = updateTaskBodySchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({
                    error: "Dados de atualização inválidos.",
                    details: formatZodIssues(parsed.error)
                });
            }

            const updated = await resolvedRepository.updateTask(id, parsed.data, {
                whatsappId
            });
            if (!updated) {
                return res.status(404).json({ error: "Tarefa não encontrada." });
            }

            return res.status(200).json(updated);
        } catch (err) {
            return next(err);
        }
    });

    app.delete("/task/:id", async (req, res, next) => {
        try {
            const { id, whatsappId, error } = parseTaskRouteParams(req);
            if (error) {
                return res.status(400).json({ error });
            }

            const deleted = await resolvedRepository.deleteTask(id, { whatsappId });
            if (!deleted) {
                return res.status(404).json({ error: "Tarefa não encontrada." });
            }

            return res.status(200).json({ deleted: true, id });
        } catch (err) {
            return next(err);
        }
    });

    app.post("/message", async (req, res, next) => {
        try {
            const parsed = messageBodySchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({
                    error: "Payload de mensagem inválido.",
                    details: formatZodIssues(parsed.error)
                });
            }

            const from = parsed.data.from ?? parsed.data.user ?? DEFAULT_HTTP_USER_ID;
            const body = parsed.data.body ?? parsed.data.message;
            const replies = [];

            const fakeMsg = {
                from,
                body,
                reply: async (text) => {
                    replies.push(text);
                }
            };

            await messageHandler(fakeMsg);
            return res.status(200).json({ from, replies });
        } catch (err) {
            return next(err);
        }
    });

    app.use((req, res) => {
        return res.status(404).json({ error: "Rota não encontrada." });
    });

    app.use((err, req, res, _next) => {
        if (
            err.type === "entity.parse.failed" ||
            (err instanceof SyntaxError && err.status === 400)
        ) {
            return res.status(400).json({
                error: "JSON inválido no corpo da requisição."
            });
        }

        if (err.type === "entity.too.large" || err.status === 413) {
            return res.status(413).json({
                error: "Corpo da requisição excede o limite permitido."
            });
        }

        console.error("Erro interno no servidor HTTP:", err.message);
        return res.status(500).json({ error: "Erro interno no servidor." });
    });

    return app;
}

export function startHttpServer({ port, host = "127.0.0.1", ...deps } = {}) {
    const resolvedPort = port ?? getEnv().HTTP_PORT;
    const app = createApp(deps);

    return new Promise((resolve, reject) => {
        const server = app.listen(resolvedPort, host);

        const onListening = () => {
            server.off("error", onError);
            resolve(server);
        };

        const onError = (err) => {
            server.off("listening", onListening);
            reject(err);
        };

        server.once("listening", onListening);
        server.once("error", onError);
    });
}
