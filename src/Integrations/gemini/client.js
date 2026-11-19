import { GoogleGenAI } from "@google/genai";
import { getEnv } from "../../config/env.js";

let cachedAiClient = null;

export function createGeminiClient(apiKey = getEnv().GEMINI_API_KEY) {
    return new GoogleGenAI({ apiKey });
}

export function getAiClient() {
    if (!cachedAiClient) {
        cachedAiClient = createGeminiClient();
    }

    return cachedAiClient;
}

export function resetAiClient() {
    cachedAiClient = null;
}

export const ai = new Proxy(
    {},
    {
        get(_target, prop) {
            const client = getAiClient();
            const value = Reflect.get(client, prop, client);
            return typeof value === "function" ? value.bind(client) : value;
        },
    }
);
