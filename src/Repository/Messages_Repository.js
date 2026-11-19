import { isValidCalendarDate } from "./Task_Repository.js";

export const commands = `Lista de comandos:

*Todas*: Mostra todas as atividades ainda não concluidas.

*Apagar*: Apaga uma atividade com base no número de ID.`;

export const EMPTY_TASKS_MESSAGE = "Não há atividades! Aproveite!";
export const TASK_SAVED_MESSAGE = "Atividade Salva!  ✅";
export const GEMINI_OVERLOADED_MESSAGE = "Servidor Gemini lotado, tente novamente em breve.";
export const GENERIC_ERROR_MESSAGE = "Ocorreu um erro ao processar sua mensagem.";
export const DEFAULT_FALLBACK_REPLY = "Não consegui entender, repita por favor.";
export const MESSAGE_TOO_LONG_MESSAGE =
    "Mensagem muito longa. Envie uma descrição mais curta da atividade.";
export const INVALID_DELETE_COMMAND_MESSAGE =
    "Informe o número do ID para apagar. Exemplo: apagar 1";
export const UNAUTHORIZED_ADMIN_COMMAND_MESSAGE =
    "Comando restrito ao administrador autorizado.";
export const TEST_STORAGE_CLEARED_MESSAGE =
    "Storage de teste limpo com sucesso! 🧹";

export function formatTaskDeletedMessage(taskId, remainingCount) {
    const baseMessage = `Atividade #${taskId} apagada com sucesso! 🗑️`;
    if (remainingCount === 0) {
        return baseMessage;
    }

    return `${baseMessage}\nOs IDs restantes foram reorganizados — digite *todas* para conferir.`;
}

export function formatTaskNotFoundMessage(taskId) {
    return `Não encontrei nenhuma atividade com o ID ${taskId}.`;
}

const MISSING_VALUE_LABEL = "Não informada";
const DEFAULT_MAX_MESSAGES_PER_USER = 6;
const DEFAULT_CONVERSATION_TTL_MS = 15 * 60 * 1000;
const DEFAULT_MAX_CONVERSATION_USERS = 1000;
const VALID_CONVERSATION_ROLES = new Set(["user", "assistant"]);

function formatTaskId(task) {
    const rawId = task?.user_task_id ?? task?.id;
    if (rawId === null || rawId === undefined) {
        return null;
    }

    if (typeof rawId === "number") {
        return Number.isFinite(rawId) ? String(rawId) : null;
    }

    if (typeof rawId === "string") {
        const trimmed = rawId.trim();
        return trimmed.length > 0 ? trimmed : null;
    }

    return null;
}

function formatOptionalText(value) {
    if (typeof value !== "string") {
        return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function formatTaskNote(nota) {
    if (typeof nota === "number") {
        return Number.isFinite(nota) ? String(nota) : null;
    }

    if (typeof nota === "string") {
        const trimmed = nota.trim();
        if (trimmed.length === 0) {
            return null;
        }

        const parsed = Number(trimmed);
        return Number.isFinite(parsed) ? trimmed : null;
    }

    return null;
}

export function readable_date(date) {
    if (date === null || date === undefined) {
        return MISSING_VALUE_LABEL;
    }

    if (date instanceof Date) {
        if (Number.isNaN(date.getTime())) {
            return MISSING_VALUE_LABEL;
        }

        const dia = String(date.getUTCDate()).padStart(2, "0");
        const mes = String(date.getUTCMonth() + 1).padStart(2, "0");
        return `${dia}/${mes}`;
    }

    if (typeof date !== "string") {
        return MISSING_VALUE_LABEL;
    }

    const trimmed = date.trim();
    if (!trimmed) {
        return MISSING_VALUE_LABEL;
    }

    const datePart = trimmed.split("T")[0];
    if (!isValidCalendarDate(datePart)) {
        return MISSING_VALUE_LABEL;
    }

    const [, mes, dia] = datePart.split("-");
    return `${dia}/${mes}`;
}

export function sucess_task_msg(task) {
    const lines = [];

    const displayId = formatTaskId(task);
    if (displayId !== null) {
        lines.push(`*ID*: ${displayId}`);
    }

    const titulo = formatOptionalText(task?.titulo);
    if (titulo !== null) {
        lines.push(`*Titulo*: ${titulo}`);
    }

    const materia = formatOptionalText(task?.materia);
    if (materia !== null) {
        lines.push(`*Materia*: ${materia}`);
    }

    const nota = formatTaskNote(task?.nota);
    if (nota !== null) {
        lines.push(`*Nota*: ${nota}`);
    }

    const formattedDate = readable_date(task?.data_entrega);
    if (formattedDate !== MISSING_VALUE_LABEL) {
        lines.push(`*Data* de entrega: ${formattedDate}`);
    }

    const observacoes = formatOptionalText(task?.observacoes);
    if (observacoes !== null) {
        lines.push(`*Observacoes*: ${observacoes}`);
    }

    return lines.join("\n");
}

export function formatTasksListMessage(tasks) {
    if (!Array.isArray(tasks) || tasks.length === 0) {
        return EMPTY_TASKS_MESSAGE;
    }

    const items = tasks
        .map((task) => sucess_task_msg(task))
        .filter((item) => item.length > 0);

    if (items.length === 0) {
        return EMPTY_TASKS_MESSAGE;
    }

    return `Suas atividades:\n\n${items.join("\n\n──────────\n\n")}`;
}

export function createConversationMemory(options = {}) {
    const {
        maxMessagesPerUser = DEFAULT_MAX_MESSAGES_PER_USER,
        ttlMs = DEFAULT_CONVERSATION_TTL_MS,
        maxUsers = DEFAULT_MAX_CONVERSATION_USERS,
    } = options ?? {};

    const historyMap = new Map();

    function filterActiveEntries(entries, now) {
        return entries.filter((entry) => now - entry.timestamp <= ttlMs);
    }

    function pruneExpiredUsers(now) {
        for (const [userId, entries] of historyMap.entries()) {
            const active = filterActiveEntries(entries, now);
            if (active.length === 0) {
                historyMap.delete(userId);
            } else if (active.length !== entries.length) {
                historyMap.set(userId, active);
            }
        }
    }

    function addMessage(whatsappId, role, text, now = Date.now()) {
        if (typeof whatsappId !== "string" || whatsappId.trim().length === 0) {
            return;
        }
        if (!VALID_CONVERSATION_ROLES.has(role)) {
            return;
        }
        if (typeof text !== "string" || text.trim().length === 0) {
            return;
        }
        if (typeof now !== "number" || !Number.isFinite(now)) {
            return;
        }
        if (maxMessagesPerUser <= 0 || maxUsers <= 0) {
            return;
        }

        const normalizedId = whatsappId.trim();
        const trimmedText = text.trim();

        const existingEntries = historyMap.get(normalizedId) ?? [];
        const activeEntries = filterActiveEntries(existingEntries, now);

        if (!historyMap.has(normalizedId) && historyMap.size >= maxUsers) {
            pruneExpiredUsers(now);
            if (historyMap.size >= maxUsers) {
                const oldestKey = historyMap.keys().next().value;
                if (oldestKey !== undefined) {
                    historyMap.delete(oldestKey);
                }
            }
        }

        const nextEntries = [
            ...activeEntries,
            { role, text: trimmedText, timestamp: now },
        ].slice(-maxMessagesPerUser);

        historyMap.set(normalizedId, nextEntries);
    }

    function getHistory(whatsappId, now = Date.now()) {
        if (typeof whatsappId !== "string" || whatsappId.trim().length === 0) {
            return [];
        }
        if (typeof now !== "number" || !Number.isFinite(now)) {
            return [];
        }

        const normalizedId = whatsappId.trim();
        const entries = historyMap.get(normalizedId);
        if (!entries) {
            return [];
        }

        const activeEntries = filterActiveEntries(entries, now);
        if (activeEntries.length === 0) {
            historyMap.delete(normalizedId);
            return [];
        }

        if (activeEntries.length !== entries.length) {
            historyMap.set(normalizedId, activeEntries);
        }

        return activeEntries.map((entry) => ({ ...entry }));
    }

    function clearHistory(whatsappId) {
        if (whatsappId !== undefined && whatsappId !== null) {
            if (typeof whatsappId === "string" && whatsappId.trim().length > 0) {
                historyMap.delete(whatsappId.trim());
            }
            return;
        }

        historyMap.clear();
    }

    return {
        addMessage,
        getHistory,
        clearHistory,
    };
}

export const conversationMemory = createConversationMemory();
