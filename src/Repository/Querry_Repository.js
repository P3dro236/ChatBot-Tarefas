const querry_post = (task) => {
    return `
    INSTERT INTO TASK(
    task.titulo,
    task.tipo,
    task.data_entrega,
    task.observacoes,
    task.notas,
    task.sucesso
    )
    `
}

