
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const resultado = dotenv.config({
    path: path.join(__dirname, ".env"),
    override: true
});

if (resultado.error) {
    throw resultado.error;
}

if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY não encontrada em config/.env");
}

export const env = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY
};