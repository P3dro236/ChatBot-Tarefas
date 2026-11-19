import { z } from "zod";
import { Task } from "../Model/Task.js";

export const TASK_TYPES = [
    "trabalho",
    "prova",
    "apresentacao",
    "leitura",
    "exercicio",
    "outro",
];

export const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function isValidCalendarDate(value) {
    if (typeof value !== "string" || !DATE_REGEX.test(value)) {
        return false;
    }

    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));

    return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
    );
}

const dateStringSchema = z
    .string()
    .regex(DATE_REGEX, "Data deve estar no formato YYYY-MM-DD.")
    .refine(isValidCalendarDate, "Data de entrega inválida.");

function optionalNullableText(maxLength) {
    return z
        .string()
        .trim()
        .max(maxLength)
        .transform((value) => (value === "" ? null : value))
        .nullable()
        .optional();
}

export const atividade_schema = {
    type: "object",
    properties: {
        titulo: {
            type: "string",
            description:
                "Título conciso ou nome da atividade (ex: 'Prova de Cálculo', 'Resumo do Capítulo 3').",
        },
        materia: {
            type: ["string", "null"],
            description:
                "Nome da disciplina ou matéria relacionada. Null se não puder ser inferido.",
        },
        tipo: {
            type: "string",
            enum: [...TASK_TYPES],
            description: "Categoria principal da atividade.",
        },
        data_entrega: {
            type: ["string", "null"],
            description:
                "Data de entrega ou de realização no formato YYYY-MM-DD. Calcular datas relativas com base na data atual. Null se não informado.",
        },
        observacoes: {
            type: ["string", "null"],
            description:
                "Qualquer detalhe extra e relevante da mensagem (ex: 'em grupo de 4 pessoas', 'páginas 10 a 50', 'peso 2 na média'). Null se não houver.",
        },
        nota: {
            type: ["number", "null"],
            description:
                "A nota declarada pelo usuário para o valor da atividade, o valor numerico deve obrigatoriamente estar descrito aqui, e nao em outros lugares como observacoes, podendo ser tanto inteira tanto conter valores com virgula (ex: 3.5, 12, 15). Null se não houver.",
        },
        sucesso: {
            type: "boolean",
            description:
                "Caso a mensagem não faça sentido com a proposta de sua função, ou caso o entendimento geral não seja feito, deve retornar como false, em caso de compreensão da mensagem e correta tradução para json o valor deve ser true. Caso uma das informações obrigatorias dentro de required for vazio, deve retornar o valor como false",
        },
        retorno: {
            type: ["string", "null"],
            description:
                "Caso o sucesso seja falso, deve deixar uma mensagem de porque o erro aconteceu ou qual campo obrigatorio esta em branco (EX: qual a materia? , qual a data?), deixe um erro detalhado, caso tenha faltado algum campo deixe claro qual campo faltou, caso o sucesso seja true então o valor deve ser null EX(Não consegui entender, repita por favor.), faça o possível para agir como uma conversa normal, seja despojado e o mais curto possivel, fazendo com que a mensagem seja entendida corretamente",
        },
    },
    required: [
        "titulo",
        "materia",
        "tipo",
        "data_entrega",
        "sucesso",
        "retorno",
    ],
};

const aiSuccessResponseSchema = z.object({
    sucesso: z.literal(true),
    titulo: z.string().trim().min(1).max(255),
    materia: optionalNullableText(255),
    tipo: z.enum(TASK_TYPES),
    data_entrega: dateStringSchema.nullable().optional(),
    observacoes: optionalNullableText(2000),
    nota: z.number().finite().min(0).nullable().optional(),
    retorno: z.string().nullable().optional(),
});

const aiFailureResponseSchema = z.object({
    sucesso: z.literal(false),
    titulo: z.string().nullable().optional(),
    materia: z.string().nullable().optional(),
    tipo: z.string().nullable().optional(),
    data_entrega: z.string().nullable().optional(),
    observacoes: z.string().nullable().optional(),
    nota: z.number().finite().nullable().optional(),
    retorno: z.string().nullable().optional(),
});

export const aiTaskResponseSchema = z.discriminatedUnion("sucesso", [
    aiSuccessResponseSchema,
    aiFailureResponseSchema,
]);

const taskFieldsSchema = z.object({
    titulo: z.string().trim().min(1).max(255),
    materia: optionalNullableText(255),
    tipo: z.enum(TASK_TYPES),
    data_entrega: dateStringSchema.nullable().optional(),
    observacoes: optionalNullableText(2000),
    nota: z.number().finite().min(0).nullable().optional(),
});

export const createTaskBodySchema = taskFieldsSchema
    .extend({
        whatsapp_id: z.string().trim().min(1).max(100).optional(),
        user: z.string().trim().min(1).max(100).optional(),
    })
    .strict();

export const updateTaskBodySchema = taskFieldsSchema
    .partial()
    .strict()
    .refine(
        (data) => Object.keys(data).some((key) => data[key] !== undefined),
        { message: "Informe ao menos um campo para atualizar." }
    );

function normalizeWhatsappId(whatsappId) {
    if (typeof whatsappId !== "string" || whatsappId.trim().length === 0) {
        throw new Error("whatsappId deve ser uma string não vazia.");
    }

    return whatsappId.trim();
}

export function createInMemoryTaskRepository() {
    const storage = new Map();

    function getOrCreateBucket(normalizedId) {
        let bucket = storage.get(normalizedId);
        if (!bucket) {
            bucket = { tasks: [] };
            storage.set(normalizedId, bucket);
        }
        return bucket;
    }

    function reindexBucket(bucket) {
        bucket.tasks.forEach((task, index) => {
            const sequentialId = index + 1;
            task.id = sequentialId;
            task.user_task_id = sequentialId;
        });
    }

    function createTask(whatsappId, taskData) {
        const normalizedId = normalizeWhatsappId(whatsappId);

        if (!taskData || typeof taskData !== "object" || Array.isArray(taskData)) {
            throw new Error("Dados da tarefa inválidos.");
        }

        const bucket = getOrCreateBucket(normalizedId);
        const taskId = bucket.tasks.length + 1;
        const task = new Task({
            ...taskData,
            id: taskId,
            user_task_id: taskId,
            whatsapp_id: normalizedId,
        });

        const storedTask = {
            id: task.id,
            user_task_id: task.user_task_id,
            whatsapp_id: task.whatsapp_id,
            titulo: task.titulo ?? null,
            materia: task.materia ?? null,
            tipo: task.tipo ?? null,
            data_entrega: task.data_entrega ?? null,
            observacoes: task.observacoes ?? null,
            nota: task.nota ?? null,
            created_at: new Date().toISOString(),
        };

        bucket.tasks.push(storedTask);
        return { ...storedTask };
    }

    function listTasks(options = {}) {
        const whatsappId = options?.whatsappId;

        if (whatsappId !== undefined && whatsappId !== null) {
            const normalizedId = normalizeWhatsappId(whatsappId);
            const bucket = storage.get(normalizedId);
            if (!bucket) {
                return [];
            }

            return bucket.tasks
                .map((task) => ({ ...task }))
                .sort((a, b) => a.id - b.id);
        }

        const allTasks = [];
        for (const bucket of storage.values()) {
            for (const task of bucket.tasks) {
                allTasks.push({ ...task });
            }
        }

        return allTasks.sort((a, b) => {
            if (a.whatsapp_id < b.whatsapp_id) {
                return -1;
            }
            if (a.whatsapp_id > b.whatsapp_id) {
                return 1;
            }
            return a.id - b.id;
        });
    }

    function deleteUserTask(whatsappId, id) {
        const normalizedId = normalizeWhatsappId(whatsappId);

        if (!Number.isInteger(id) || id < 1) {
            return false;
        }

        const bucket = storage.get(normalizedId);
        if (!bucket) {
            return false;
        }

        const index = bucket.tasks.findIndex((task) => task.id === id);
        if (index === -1) {
            return false;
        }

        bucket.tasks.splice(index, 1);
        reindexBucket(bucket);
        return true;
    }

    function deleteTask(id, options = {}) {
        const whatsappId = options?.whatsappId;

        if (whatsappId === undefined || whatsappId === null) {
            throw new Error(
                "whatsappId é obrigatório para remover tarefa no repositório em memória."
            );
        }

        return deleteUserTask(whatsappId, id);
    }

    function clear(whatsappId) {
        if (whatsappId !== undefined && whatsappId !== null) {
            const normalizedId = normalizeWhatsappId(whatsappId);
            const bucket = storage.get(normalizedId);
            if (!bucket) {
                return 0;
            }

            const removedCount = bucket.tasks.length;
            storage.delete(normalizedId);
            return removedCount;
        }

        let totalRemoved = 0;
        for (const bucket of storage.values()) {
            totalRemoved += bucket.tasks.length;
        }
        storage.clear();
        return totalRemoved;
    }

    function count(whatsappId) {
        if (whatsappId !== undefined && whatsappId !== null) {
            const normalizedId = normalizeWhatsappId(whatsappId);
            return storage.get(normalizedId)?.tasks.length ?? 0;
        }

        let total = 0;
        for (const bucket of storage.values()) {
            total += bucket.tasks.length;
        }
        return total;
    }

    return {
        createTask,
        listTasks,
        deleteUserTask,
        deleteTask,
        clear,
        count,
    };
}

export const testTaskStorage = createInMemoryTaskRepository();
