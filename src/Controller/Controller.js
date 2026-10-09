import { text_to_json } from '../Service/Service.js'
import { Task } from '../Model/Task.js'
import { commands, sucess_task_msg } from '../Repository/Messages_Repository.js'
 
export const msg_handler = async (msg) =>{
    if(msg.body.toLowerCase() === 'comandos'){
            switch(msg.body.toLowerCase()){
            case "comandos":
                msg.reply(commands)
            break
        }
        return
    }
    try {
        const response = await text_to_json(msg.body);
        console.log(response)

        if(!response.sucesso){
            await msg.reply(response.retorno)
        } else{
            const task = new Task(response.titulo, response.materia, response.tipo, response.data_entrega, response.observacoes, response.nota)
            console.log("Task: ", task)
    
            await msg.reply(`Atividade Salva!  ✅`)
            await msg.reply(sucess_task_msg(task))
        }
    } catch (error) {
        if(error.code == 503){
            console.error("Erro ao processar mensagem:", error);
            await msg.reply("Servidor Gemini lotaqdo, tente novamente em breve.")
        } else{
            console.error("Erro ao processar mensagem:", error);
            await msg.reply("Ocorreu um erro ao processar sua mensagem.");
        }
    }
}