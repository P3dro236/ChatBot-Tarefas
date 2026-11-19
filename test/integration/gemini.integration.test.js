import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { ai } from "../../src/Integrations/gemini/client.js";
import { text_to_json } from "../../src/Service/Service.js";
import {
    DATE_REGEX,
    isValidCalendarDate,
} from "../../src/Repository/Task_Repository.js";

describe("Integração Real - Gemini API (text_to_json)", () => {
    it(
        "extrai corretamente uma tarefa acadêmica completa via API real do Gemini",
        { timeout: 60_000 },
        async () => {
            const result = await text_to_json(
                "Prova de Matemática amanhã valendo 15 pontos, estudar capítulos 3 e 4",
                { aiClient: ai }
            );

            assert.equal(result.sucesso, true);
            assert.equal(typeof result.titulo, "string");
            assert.ok(result.titulo.trim().length > 0);
            assert.equal(result.tipo, "prova");
            assert.equal(typeof result.data_entrega, "string");
            assert.match(result.data_entrega, DATE_REGEX);
            assert.equal(isValidCalendarDate(result.data_entrega), true);
            assert.equal(result.nota, 15);
            assert.equal(typeof result.materia, "string");
            assert.ok(result.materia.trim().length > 0);
        }
    );

    it(
        "retorna sucesso: false e mensagem de retorno para conversa fora de contexto",
        { timeout: 60_000 },
        async () => {
            const result = await text_to_json(
                "Oi, tudo bem? Como está o clima hoje?",
                { aiClient: ai }
            );

            assert.equal(result.sucesso, false);
            assert.equal(typeof result.retorno, "string");
            assert.ok(result.retorno.trim().length > 0);
        }
    );
});
