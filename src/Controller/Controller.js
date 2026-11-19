import { isGeminiOverloadedError, text_to_json } from "../Service/Service.js";
import { Task } from "../Model/Task.js";
import { taskDbRepository } from "../Repository/Task_Db_Repository.js";
import {
    commands,
    DEFAULT_FALLBACK_REPLY,
    EMPTY_TASKS_MESSAGE,
    GEMINI_OVERLOADED_MESSAGE,
    GENERIC_ERROR_MESSAGE,
    MESSAGE_TOO_LONG_MESSAGE,
    sucess_task_msg,
    TASK_SAVED_MESSAGE,
} from "../Repository/Messages_Repository.js";

const DEFAULT_SENDER_ID = "default_user";
export const MAX_SENDER_ID_LENGTH = 100;
export const MAX_MESSAGE_LENGTH = 4000;

function formatSafeErrorLog(error) {
    const code = error?.status ?? error?.code ?? error?.error?.code ?? "unknown";
    const rawMessage =
        typeof error?.message === "string" ? error.message : "Erro desconhecido";
    const message = rawMessage.replace(/([?&]key=)[^&\s]+/gi, "$1[REDACTED]");

    return { code, message };
}

export function getSenderId(msg) {
    if (typeof msg?.from !== "string") {
        return DEFAULT_SENDER_ID;
    }

    const normalized = msg.from.trim();
    if (!normalized) {
        return DEFAULT_SENDER_ID;
    }

    return normalized.slice(0, MAX_SENDER_ID_LENGTH);
}

export function isGeminiUnavailableError(error) {
    return isGeminiOverloadedError(error);
}

export async function handleListAllTasks(msg, whatsappId, taskRepository) {
    const tasks = await taskRepository.listTasks({ whatsappId });

    if (!Array.isArray(tasks) || tasks.length === 0) {
        await msg.reply(EMPTY_TASKS_MESSAGE);
        return;
    }

    for (const task of tasks) {
        await msg.reply(sucess_task_msg(task));
    }
}

export async function handleCreateTaskFromMessage(
    msg,
    whatsappId,
    extractTask,
    taskRepository
) {
    const response = await extractTask(msg.body);

    if (response.sucesso === false) {
        const replyMessage = response.retorno?.trim() || DEFAULT_FALLBACK_REPLY;
        await msg.reply(replyMessage);
        return;
    }

    const task = new Task({
        whatsapp_id: whatsappId,
        titulo: response.titulo,
        materia: response.materia,
        tipo: response.tipo,
        data_entrega: response.data_entrega,
        observacoes: response.observacoes,
        nota: response.nota,
        sucesso: response.sucesso,
        retorno: response.retorno,
    });

    const savedTask = await taskRepository.createTask(
        whatsappId,
        task.toPersistenceData()
    );

    await msg.reply(TASK_SAVED_MESSAGE);
    await msg.reply(sucess_task_msg(savedTask ?? task));
}

export function createMessageHandler({
    extractTask = text_to_json,
    taskRepository = taskDbRepository,
} = {}) {
    return async function handleMessage(msg) {
        if (!msg || typeof msg.body !== "string") {
            return;
        }

        const messageBody = msg.body.trim();
        if (!messageBody) {
            return;
        }

        const normalizedCommand = messageBody.toLowerCase();
        const whatsappId = getSenderId(msg);

        try {
            if (messageBody.length > MAX_MESSAGE_LENGTH) {
                await msg.reply(MESSAGE_TOO_LONG_MESSAGE);
                return;
            }

            if (normalizedCommand === "comandos") {
                await msg.reply(commands);
                return;
            }

            if (normalizedCommand === "todas") {
                await handleListAllTasks(msg, whatsappId, taskRepository);
                return;
            }

            await handleCreateTaskFromMessage(
                msg,
                whatsappId,
                extractTask,
                taskRepository
            );
        } catch (error) {
            console.error("Erro ao processar mensagem:", formatSafeErrorLog(error));

            if (isGeminiOverloadedError(error)) {
                await msg.reply(GEMINI_OVERLOADED_MESSAGE);
                return;
            }

            await msg.reply(GENERIC_ERROR_MESSAGE);
        }
    };
}

export const msg_handler = createMessageHandler();
