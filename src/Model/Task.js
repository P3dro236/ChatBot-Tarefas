export class Task{
    constructor(titulo, materia, tipo, data_entrega, observacoes, nota, sucesso, retorno){
        // this.user = user
        this.titulo = titulo
        this.materia = materia
        this.tipo = tipo
        this.data_entrega = data_entrega
        this.observacoes = observacoes
        this.nota = nota
        this.sucesso = sucesso
        this.retorno = retorno
    }
    post(){
        //Aqui expressão em express para subir os dados ao banco de dados
    }
}