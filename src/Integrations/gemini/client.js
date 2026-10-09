import { env } from '../../Config/env.js'
import { GoogleGenAI } from "@google/genai";
export const ai = new GoogleGenAI({
    apiKey: env.GEMINI_API_KEY
});