
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const resultado = dotenv.config({
    path: path.join(__dirname, ".env"),
    override: true
});

export const env = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    HOST: process.env.HOST,
    USER: process.env.USER,
    PASSWORD: process.env.PASSWORD,
    PORT: process.env.PORT
};