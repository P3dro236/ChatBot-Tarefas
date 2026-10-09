import { ai } from '../Integrations/gemini/client.js'
import { atividade_schema } from '../Repository/Task_Repository.js'
const date = new Date


export async function text_to_json(input){
    const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents:`
        Você é um assistente especializado na extração estruturada de dados para organização de tarefas acadêmicas.

        Contexto de Tempo:
        - Data atual: ${date}

        Sua missão é analisar a mensagem do usuário e extrair os parâmetros para cadastrar a atividade. 

        Regras estritas:
        1. Responda ÚNICA E EXCLUSIVAMENTE com um objeto JSON válido. Não inclua saudações, explicações ou formatação markdown (json).
        2. Não invente informações. Se um dado não estiver explícito ou implícito na mensagem, retorne null.
        3. Datas relativas: Converta termos como "amanhã", "depois de amanhã" ou "quinta que vem" para datas exatas no formato YYYY-MM-DD, usando a data atual como base.
        4. Título conciso: Crie um "titulo" claro e direto baseado na ação solicitada.
        5. Caso a mensagem não faça sentido a sua função, deve retornar todas 

        Mensagem:
        ${input}`,

    config:{
        responseMimeType: "application/json",
        responseJsonSchema: atividade_schema
    }
    })
    return JSON.parse(response.text)
}
