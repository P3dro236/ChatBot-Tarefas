function normalizeTaskInput(firstArg, restArgs) {
    if (firstArg && typeof firstArg === "object" && !Array.isArray(firstArg)) {
        return firstArg;
    }

    const [materia, tipo, data_entrega, observacoes, nota, sucesso, retorno] = restArgs;
    return {
        titulo: firstArg,
        materia,
        tipo,
        data_entrega,
        observacoes,
        nota,
        sucesso,
        retorno,
    };
}

export class Task {
    constructor(firstArg = {}, ...restArgs) {
        const {
            id = null,
            user_task_id = null,
            whatsapp_id = null,
            titulo = null,
            materia = null,
            tipo = null,
            data_entrega = null,
            observacoes = null,
            nota = null,
            sucesso = null,
            retorno = null,
        } = normalizeTaskInput(firstArg, restArgs);

        this.id = id;
        this.user_task_id = user_task_id ?? id;
        this.whatsapp_id = whatsapp_id;
        this.titulo = titulo;
        this.materia = materia;
        this.tipo = tipo;
        this.data_entrega = data_entrega;
        this.observacoes = observacoes;
        this.nota = nota;
        this.sucesso = sucesso;
        this.retorno = retorno;
    }

    toPersistenceData() {
        return {
            titulo: this.titulo,
            materia: this.materia,
            tipo: this.tipo,
            data_entrega: this.data_entrega,
            observacoes: this.observacoes,
            nota: this.nota,
        };
    }
}
