import { getEnv } from "../config/env.js";
import { getAiClient } from "../Integrations/gemini/client.js";
import {
    aiTaskResponseSchema,
    atividade_schema,
} from "../Repository/Task_Repository.js";

const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";
const OVERLOAD_STATUS_CODES = new Set([429, 503]);
const NOT_FOUND_STATUS_CODES = new Set([404]);

const OVERLOAD_ERROR_PATTERNS = [
    { label: "503", pattern: /\b503\b/i },
    { label: "429", pattern: /\b429\b/i },
    { label: "UNAVAILABLE", pattern: /unavailable/i },
    { label: "overloaded", pattern: /overloaded/i },
    { label: "RESOURCE_EXHAUSTED", pattern: /resource_exhausted/i },
    { label: "quota", pattern: /quota/i },
];

const NOT_FOUND_ERROR_PATTERNS = [
    { label: "404", pattern: /\b404\b/i },
    { label: "NOT_FOUND", pattern: /not_found|not found/i },
];

const FALLBACK_ERROR_PATTERNS = [
    ...OVERLOAD_ERROR_PATTERNS,
    ...NOT_FOUND_ERROR_PATTERNS,
];

function resolveCurrentDate(now) {
    const raw = typeof now === "function" ? now() : now;
    if (raw === undefined || raw === null) {
        return new Date();
    }

    const resolved = raw instanceof Date ? raw : new Date(raw);
    return Number.isNaN(resolved.getTime()) ? new Date() : resolved;
}

function formatLocalDateTime(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");

    const offsetMinutes = -date.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? "+" : "-";
    const absOffset = Math.abs(offsetMinutes);
    const offsetHours = String(Math.floor(absOffset / 60)).padStart(2, "0");
    const offsetMins = String(absOffset % 60).padStart(2, "0");

    return `${year}-${month}-${day} ${hours}:${minutes} (UTC${sign}${offsetHours}:${offsetMins})`;
}

function extractNumericCode(error) {
    const candidates = [
        error?.status,
        error?.code,
        error?.error?.code,
        error?.response?.status,
    ];

    for (const candidate of candidates) {
        if (candidate === null || candidate === undefined || candidate === "") {
            continue;
        }
        const numeric = Number(candidate);
        if (Number.isInteger(numeric)) {
            return numeric;
        }
    }

    return null;
}

function collectErrorTextSignals(error) {
    return [
        error?.status,
        error?.code,
        error?.error?.status,
        error?.response?.status,
        error?.message,
    ]
        .filter((value) => typeof value === "string")
        .join(" ");
}

function isModelNotFoundError(error) {
    if (!error || typeof error !== "object") {
        return false;
    }

    const numericCode = extractNumericCode(error);
    if (numericCode !== null && NOT_FOUND_STATUS_CODES.has(numericCode)) {
        return true;
    }

    const signals = collectErrorTextSignals(error);
    return NOT_FOUND_ERROR_PATTERNS.some(({ pattern }) => pattern.test(signals));
}

function extractSafeErrorReason(error) {
    const numericCode = extractNumericCode(error);
    if (numericCode !== null) {
        return String(numericCode);
    }

    const signals = collectErrorTextSignals(error);
    const matched = FALLBACK_ERROR_PATTERNS.find(({ pattern }) => pattern.test(signals));
    return matched ? matched.label : "indisponível";
}

export function isGeminiOverloadedError(error) {
    if (!error || typeof error !== "object") {
        return false;
    }

    const numericCode = extractNumericCode(error);
    if (numericCode !== null && OVERLOAD_STATUS_CODES.has(numericCode)) {
        return true;
    }

    const signals = collectErrorTextSignals(error);
    return OVERLOAD_ERROR_PATTERNS.some(({ pattern }) => pattern.test(signals));
}

export function buildPrompt(input, currentDate = new Date()) {
    const safeDate = resolveCurrentDate(currentDate);
    const formattedDate = formatLocalDateTime(safeDate);

    return `
Você é um assistente especializado na extração estruturada de dados para organização de tarefas acadêmicas.

Contexto de Tempo:
- Data atual (horário local): ${formattedDate}

Sua missão é analisar a mensagem do usuário e extrair os parâmetros para cadastrar a atividade.

Regras estritas:
1. Responda ÚNICA E EXCLUSIVAMENTE com um objeto JSON válido. Não inclua saudações, explicações ou formatação markdown (json).
2. Não invente informações. Se um dado não estiver explícito ou implícito na mensagem, retorne null.
3. Datas relativas: Converta termos como "amanhã", "depois de amanhã" ou "quinta que vem" para datas exatas no formato YYYY-MM-DD, usando a data atual como base.
4. Título conciso: Crie um "titulo" claro e direto baseado na ação solicitada.
5. Caso a mensagem não faça sentido a sua função, deve retornar todas.
6. Para melhor organização, sempre deixe as primeiras letras maiusculas, por exemplo, Matematica e Banco de dados.

Mensagem:
${input}`.trim();
}

export function resolveCandidateModels(depsModels) {
    let rawModels;
    if (Array.isArray(depsModels) && depsModels.length > 0) {
        rawModels = depsModels;
    } else {
        const currentEnv = getEnv();
        rawModels = [
            currentEnv.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
            ...(currentEnv.GEMINI_FALLBACK_MODELS ?? []),
        ];
    }

    const uniqueModels = new Set();
    for (const model of rawModels) {
        if (typeof model !== "string") {
            continue;
        }
        const trimmed = model.trim();
        if (trimmed) {
            uniqueModels.add(trimmed);
        }
    }

    return [...uniqueModels];
}

export function shouldFallbackToNextModel(error) {
    return isGeminiOverloadedError(error) || isModelNotFoundError(error);
}

export async function generateTaskJson(aiClient, model, prompt) {
    const response = await aiClient.models.generateContent({
        model,
        contents: prompt,
        config: {
            responseMimeType: "application/json",
            responseJsonSchema: atividade_schema,
        },
    });

    if (!response?.text || typeof response.text !== "string") {
        throw new Error(`Resposta vazia do modelo "${model}".`);
    }

    const parsed = JSON.parse(response.text);
    return aiTaskResponseSchema.parse(parsed);
}

export async function text_to_json(input, deps = {}) {
    const aiClient = deps.aiClient ?? getAiClient();
    const candidateModels = resolveCandidateModels(deps.models);
    const currentDate = resolveCurrentDate(deps.now);

    if (candidateModels.length === 0) {
        throw new Error("Nenhum modelo Gemini configurado.");
    }

    const prompt = buildPrompt(input, currentDate);
    let lastError;
    let firstOverloadError = null;

    for (let index = 0; index < candidateModels.length; index++) {
        const model = candidateModels[index];
        const nextModel = candidateModels[index + 1];

        try {
            return await generateTaskJson(aiClient, model, prompt);
        } catch (error) {
            lastError = error;

            if (isGeminiOverloadedError(error) && !firstOverloadError) {
                firstOverloadError = error;
            }

            if (!shouldFallbackToNextModel(error)) {
                throw error;
            }

            if (!nextModel) {
                throw isModelNotFoundError(error) && firstOverloadError
                    ? firstOverloadError
                    : error;
            }

            const reason = extractSafeErrorReason(error);
            console.warn(
                `[Gemini] Modelo "${model}" indisponível (${reason}). Tentando fallback "${nextModel}".`
            );
        }
    }

    throw firstOverloadError ?? lastError;
}
