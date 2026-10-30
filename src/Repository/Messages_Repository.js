export const commands = (`Lista de comandos:

*Todas*: Mostra todas as atividades ainda não concluidas.

*Apagar*: Apaga uma atividade com base no número de ID.`)

export const sucess_task_msg = (task) => {
    return `*Titulo*: ${task.titulo}
*Materia*: ${task.materia}
*Nota*: ${task.nota}
*Data* de entrega: ${readable_date(task.data_entrega)}`}

const readable_date = (date) =>{
    const [ano, mes, dia] = date.split("-");
    return `${dia}/${mes}`;
}