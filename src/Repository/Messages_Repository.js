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

const MISSING_VALUE_LABEL = "Não informada";

function formatOptionalField(value) {
    if (value === null || value === undefined) {
        return MISSING_VALUE_LABEL;
    }

    if (typeof value === "string" && value.trim() === "") {
        return MISSING_VALUE_LABEL;
    }

    return value;
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
    const titulo = formatOptionalField(task?.titulo);
    const materia = formatOptionalField(task?.materia);
    const nota = formatOptionalField(task?.nota);
    const dataEntrega = readable_date(task?.data_entrega);

    return `*Titulo*: ${titulo}
*Materia*: ${materia}
*Nota*: ${nota}
*Data* de entrega: ${dataEntrega}`;
}
