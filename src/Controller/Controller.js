import { text_to_json } from '../Service/Service.js'
import { Task } from '../Model/Task.js'
import { commands, sucess_task_msg } from '../Repository/Messages_Repository.js'

let local_storage = [
{
  titulo: 'Prova de química',
  materia: 'química',
  tipo: 'prova',
  data_entrega: '2026-10-17',
  observacoes: null,
  nota: 25
},
{
  titulo: 'Prova de química',
  materia: 'química',
  tipo: 'prova',
  data_entrega: '2026-10-17',
  observacoes: null,
  nota: 25
}
]


export const msg_handler = async (msg) =>{
    if(msg.body.toLowerCase() === 'comandos' || msg.body.toLowerCase() === 'todas'){
            switch(msg.body.toLowerCase()){
            case "comandos":
                msg.reply(commands)
            break
            case "todas":
                if(local_storage.length === 0){
                    msg.reply("Não há atividades! Aproveite!")
                } else{
                    console.log("Local:", local_storage[0])
                    console.log(local_storage.length)
                    for (let i = 0; i < local_storage.length; i++) {
                        await msg.reply(sucess_task_msg(local_storage[i]))
                    }   
                }
            break
        }
        return
    }
    try {
        const response = await text_to_json(msg.body);
        if(!response.sucesso){
            await msg.reply(response.retorno)
        } else{
            const task = new Task(response.titulo, response.materia, response.tipo, response.data_entrega, response.observacoes, response.nota)
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