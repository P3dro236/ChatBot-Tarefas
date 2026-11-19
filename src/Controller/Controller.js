import { getEnv } from "../config/env.js";
import { isGeminiOverloadedError, text_to_json } from "../Service/Service.js";
import { Task } from "../Model/Task.js";
import { taskDbRepository } from "../Repository/Task_Db_Repository.js";
import { testTaskStorage } from "../Repository/Task_Repository.js";
import {
    commands,
    conversationMemory,
    DEFAULT_FALLBACK_REPLY,
    formatTaskDeletedMessage,
    formatTaskNotFoundMessage,
    formatTasksListMessage,
    GEMINI_OVERLOADED_MESSAGE,
    GENERIC_ERROR_MESSAGE,
    INVALID_DELETE_COMMAND_MESSAGE,
    MESSAGE_TOO_LONG_MESSAGE,
    sucess_task_msg,
    TASK_SAVED_MESSAGE,
    TEST_STORAGE_CLEARED_MESSAGE,
    UNAUTHORIZED_ADMIN_COMMAND_MESSAGE,
} from "../Repository/Messages_Repository.js";

const DEFAULT_SENDER_ID = "default_user";
const MIN_ADMIN_DIGITS = 8;
const MAX_POSTGRES_INT = 2147483647;
const INDIVIDUAL_SENDER_REGEX = /^\d+(?:@(?:c\.us|s\.whatsapp\.net|lid))?$/i;
export const MAX_SENDER_ID_LENGTH = 100;
export const MAX_MESSAGE_LENGTH = 4000;

export const DEFAULT_TEST_MESSAGES = Object.freeze([
    "Prova de Cálculo amanhã valendo 15 pontos",
    "Trabalho de Banco de Dados para entregar sexta-feira",
]);

function formatSafeErrorLog(error) {
    const code = error?.status ?? error?.code ?? error?.error?.code ?? "unknown";
    const rawMessage =
        typeof error?.message === "string" ? error.message : "Erro desconhecido";
    const message = rawMessage.replace(/([?&]key=)[^&\s]+/gi, "$1[REDACTED]");

    return { code, message };
}

function extractDigitsBeforeAt(identifier) {
    const [localPart] = identifier.split("@");
    return localPart.replace(/\D/g, "");
}

function buildTaskFromAiResponse(whatsappId, response) {
    return new Task({
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

export function isAuthorizedTestAdmin(whatsappId, adminTestNumber) {
    if (typeof whatsappId !== "string" || typeof adminTestNumber !== "string") {
        return false;
    }

    const normalizedSender = whatsappId.trim();
    const normalizedAdmin = adminTestNumber.trim();
    if (!normalizedSender || !normalizedAdmin) {
        return false;
    }

    if (
        normalizedSender.toLowerCase().endsWith("@g.us") ||
        normalizedAdmin.toLowerCase().endsWith("@g.us")
    ) {
        return false;
    }

    if (!INDIVIDUAL_SENDER_REGEX.test(normalizedSender)) {
        return false;
    }

    const senderDigits = extractDigitsBeforeAt(normalizedSender);
    const adminDigits = extractDigitsBeforeAt(normalizedAdmin);
    if (adminDigits.length < MIN_ADMIN_DIGITS) {
        return false;
    }

    if (normalizedSender === normalizedAdmin) {
        return true;
    }

    return senderDigits === adminDigits;
}

export function parseDeleteTaskId(messageBody) {
    if (typeof messageBody !== "string") {
        return { isDeleteCommand: false, taskId: null };
    }

    const trimmed = messageBody.trim();
    const match = /^apagar(?:\s+(.*))?$/i.exec(trimmed);
    if (!match) {
        return { isDeleteCommand: false, taskId: null };
    }

    const rawArg = match[1]?.trim() ?? "";
    if (!/^\d+$/.test(rawArg)) {
        return { isDeleteCommand: true, taskId: null };
    }

    const taskId = Number(rawArg);
    if (
        !Number.isSafeInteger(taskId) ||
        taskId < 1 ||
        taskId > MAX_POSTGRES_INT
    ) {
        return { isDeleteCommand: true, taskId: null };
    }

    return { isDeleteCommand: true, taskId };
}

export async function handleListAllTasks(msg, whatsappId, taskRepository) {
    const tasks = await taskRepository.listTasks({ whatsappId });
    await msg.reply(formatTasksListMessage(tasks));
}

export async function handleDeleteTask(msg, whatsappId, taskId, taskRepository) {
    if (taskId === null || taskId === undefined) {
        await msg.reply(INVALID_DELETE_COMMAND_MESSAGE);
        return;
    }

    const deleted =
        typeof taskRepository.deleteUserTask === "function"
            ? await taskRepository.deleteUserTask(whatsappId, taskId)
            : await taskRepository.deleteTask(taskId, { whatsappId });

    if (deleted) {
        let remainingCount;
        if (typeof taskRepository.count === "function") {
            remainingCount = await taskRepository.count(whatsappId);
        } else if (typeof taskRepository.listTasks === "function") {
            const remainingTasks = await taskRepository.listTasks({ whatsappId });
            remainingCount = Array.isArray(remainingTasks)
                ? remainingTasks.length
                : undefined;
        }

        await msg.reply(formatTaskDeletedMessage(taskId, remainingCount));
        return;
    }

    await msg.reply(formatTaskNotFoundMessage(taskId));
}

export async function handleAdminTestCommand(
    msg,
    whatsappId,
    {
        extractTask = text_to_json,
        testTaskRepository = testTaskStorage,
        testSampleMessages = DEFAULT_TEST_MESSAGES,
    } = {}
) {
    const samples = Array.isArray(testSampleMessages)
        ? testSampleMessages.filter(
              (sample) => typeof sample === "string" && sample.trim().length > 0
          )
        : [];

    if (samples.length === 0) {
        await msg.reply("Nenhuma mensagem de teste configurada.");
        return;
    }

    const simulationBlocks = [];

    for (let index = 0; index < samples.length; index++) {
        const sample = samples[index].trim();
        const response = await extractTask(sample, { history: [] });

        if (response?.sucesso === true) {
            const task = buildTaskFromAiResponse(whatsappId, response);
            const savedTask = await testTaskRepository.createTask(
                whatsappId,
                task.toPersistenceData()
            );
            simulationBlocks.push(
                `*Simulação ${index + 1}* ("${sample}"):\n${sucess_task_msg(savedTask ?? task)}`
            );
            continue;
        }

        const fallbackReply =
            response?.retorno?.trim() || DEFAULT_FALLBACK_REPLY;
        simulationBlocks.push(
            `*Simulação ${index + 1}* ("${sample}"):\n[Sem cadastro] ${fallbackReply}`
        );
    }

    const totalStored =
        typeof testTaskRepository.count === "function"
            ? await testTaskRepository.count(whatsappId)
            : (await testTaskRepository.listTasks({ whatsappId })).length;

    const consolidatedReply = [
        "🧪 *Modo Teste Isolado* (nenhuma tarefa foi gravada no banco principal)",
        ...simulationBlocks,
        `Total no storage de teste: ${totalStored}`,
    ].join("\n\n");

    await msg.reply(consolidatedReply);
}

export async function handleAdminTestClearCommand(
    msg,
    testTaskRepository = testTaskStorage
) {
    await testTaskRepository.clear();
    await msg.reply(TEST_STORAGE_CLEARED_MESSAGE);
}

export async function handleCreateTaskFromMessage(
    msg,
    whatsappId,
    messageBody,
    extractTask,
    taskRepository,
    memory
) {
    const history = memory ? memory.getHistory(whatsappId) : [];
    const response = await extractTask(messageBody, { history });

    if (response?.sucesso !== true) {
        const replyMessage =
            (typeof response?.retorno === "string"
                ? response.retorno.trim()
                : "") || DEFAULT_FALLBACK_REPLY;
        memory?.addMessage(whatsappId, "user", messageBody);
        memory?.addMessage(whatsappId, "assistant", replyMessage);
        await msg.reply(replyMessage);
        return;
    }

    const task = buildTaskFromAiResponse(whatsappId, response);
    const savedTask = await taskRepository.createTask(
        whatsappId,
        task.toPersistenceData()
    );

    memory?.clearHistory(whatsappId);

    await msg.reply(TASK_SAVED_MESSAGE);
    await msg.reply(sucess_task_msg(savedTask ?? task));
}

export function createMessageHandler({
    extractTask = text_to_json,
    taskRepository = taskDbRepository,
    conversationMemory: memory = conversationMemory,
    testTaskRepository = testTaskStorage,
    getAdminTestNumber = () => getEnv().ADMIN_TEST_NUMBER,
    testSampleMessages = DEFAULT_TEST_MESSAGES,
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

            if (normalizedCommand === "/teste") {
                if (!isAuthorizedTestAdmin(whatsappId, getAdminTestNumber())) {
                    await msg.reply(UNAUTHORIZED_ADMIN_COMMAND_MESSAGE);
                    return;
                }

                await handleAdminTestCommand(msg, whatsappId, {
                    extractTask,
                    testTaskRepository,
                    testSampleMessages,
                });
                return;
            }

            if (normalizedCommand === "/teste-limpar") {
                if (!isAuthorizedTestAdmin(whatsappId, getAdminTestNumber())) {
                    await msg.reply(UNAUTHORIZED_ADMIN_COMMAND_MESSAGE);
                    return;
                }

                await handleAdminTestClearCommand(msg, testTaskRepository);
                return;
            }

            const deleteCommand = parseDeleteTaskId(messageBody);
            if (deleteCommand.isDeleteCommand) {
                await handleDeleteTask(
                    msg,
                    whatsappId,
                    deleteCommand.taskId,
                    taskRepository
                );
                return;
            }

            await handleCreateTaskFromMessage(
                msg,
                whatsappId,
                messageBody,
                extractTask,
                taskRepository,
                memory
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
