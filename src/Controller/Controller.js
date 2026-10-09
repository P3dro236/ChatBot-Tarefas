import { text_to_json } from '../Service/Service.js'
import { Task } from '../Model/Task.js'
 
export const msg_handler = async (msg) =>{
    console.log("Mensagem recebida:", msg.body);
    if (msg.body === "!ping") {
        await msg.reply("pong");
        return;
    }
    try {
        const response = await text_to_json(msg.body);
        const task = new Task(
            response.titulo,
            response.materia,
            response.tipo,
            response.data_entrega,
            response.observacoes,
            response.nota,
        )
        console.log("Task: ", task)
        await msg.reply("Atividade Salva!")
    } catch (error) {
        console.error("Erro ao processar mensagem:", error);
        await msg.reply("Ocorreu um erro ao processar sua mensagem.");
    }
}