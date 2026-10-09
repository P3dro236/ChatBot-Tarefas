export const commands = (`Lista de comandos:

*Todas*: Mostra todas as atividades ainda não concluidas.

*Apagar*: Apaga uma atividade com base no número de ID.`)

export const sucess_task_msg = (task) => {
    return `*Titulo*: ${task.titulo}
*Materia*: ${task.materia}
*Nota*: ${task.nota}
*Data* de entrega: ${task.data_entrega}`}