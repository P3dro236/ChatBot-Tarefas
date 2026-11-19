import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE_PATH = path.join(__dirname, ".env");

const DEFAULT_GEMINI_FALLBACK_MODELS = Object.freeze([
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash",
    "gemini-2.0-flash"
]);

let dotEnvLoaded = false;
let cachedEnv = null;

function emptyStringToUndefined(value) {
    if (typeof value === "string" && value.trim() === "") {
        return undefined;
    }

    return value;
}

function loadDotEnvFile() {
    const result = dotenv.config({
        path: ENV_FILE_PATH,
        override: false,
        quiet: true
    });

    if (result.error && result.error.code !== "ENOENT") {
        throw new Error(
            `Falha ao ler arquivo de ambiente: ${result.error.code ?? "erro desconhecido"}`
        );
    }
}

const fallbackModelsSchema = z
    .union([z.string(), z.array(z.string().trim().min(1))])
    .optional()
    .transform((value) => {
        if (value === undefined) {
            return Object.freeze([...DEFAULT_GEMINI_FALLBACK_MODELS]);
        }

        if (Array.isArray(value)) {
            return Object.freeze([...value]);
        }

        const models = value
            .split(",")
            .map((model) => model.trim())
            .filter(Boolean);

        return Object.freeze(
            models.length > 0 ? models : [...DEFAULT_GEMINI_FALLBACK_MODELS]
        );
    });

const envSchema = z.object({
    GEMINI_API_KEY: z.string().trim().min(1),
    DB_HOST: z.string().trim().min(1),
    DB_PORT: z.coerce.number().int().min(1).max(65535),
    DB_USER: z.string().trim().min(1),
    DB_PASSWORD: z.string().min(1),
    DB_NAME: z.string().trim().min(1),
    HTTP_PORT: z.preprocess(
        emptyStringToUndefined,
        z.coerce.number().int().min(1).max(65535).default(3000)
    ),
    GEMINI_MODEL: z.preprocess(
        emptyStringToUndefined,
        z.string().trim().min(1).default("gemini-3.1-flash-lite")
    ),
    GEMINI_FALLBACK_MODELS: fallbackModelsSchema,
    CHROME_EXECUTABLE_PATH: z.preprocess(
        emptyStringToUndefined,
        z.string().trim().min(1).optional()
    )
});

export function loadEnv(sourceEnv = process.env) {
    const parsed = envSchema.safeParse(sourceEnv);

    if (!parsed.success) {
        const invalidFields = [
            ...new Set(
                parsed.error.issues.map((issue) => issue.path.join(".") || "env")
            )
        ];

        throw new Error(
            `Variáveis de ambiente inválidas ou ausentes: ${invalidFields.join(", ")}`
        );
    }

    return Object.freeze({ ...parsed.data });
}

export function getEnv() {
    if (cachedEnv) {
        return cachedEnv;
    }

    if (!dotEnvLoaded) {
        loadDotEnvFile();
        dotEnvLoaded = true;
    }

    cachedEnv = loadEnv(process.env);
    return cachedEnv;
}

export const env = new Proxy(
    {},
    {
        get(_target, prop) {
            return Reflect.get(getEnv(), prop);
        },
        has(_target, prop) {
            return Reflect.has(getEnv(), prop);
        },
        ownKeys() {
            return Reflect.ownKeys(getEnv());
        },
        getOwnPropertyDescriptor(_target, prop) {
            const descriptor = Reflect.getOwnPropertyDescriptor(getEnv(), prop);
            if (!descriptor) {
                return undefined;
            }

            return { ...descriptor, configurable: true };
        },
        set() {
            return false;
        },
        deleteProperty() {
            return false;
        },
        defineProperty() {
            return false;
        },
        setPrototypeOf() {
            return false;
        }
    }
);
