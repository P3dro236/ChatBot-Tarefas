export class Task{
    constructor(titulo, materia, tipo, data_entrega, observacoes, nota){
        this.titulo = titulo
        this.materia = materia
        this.tipo = tipo
        this.data_entrega = data_entrega
        this.observacoes = observacoes
        this.nota = nota
    }
    post(){
        //Aqui expressão em express para subir os dados ao banco de dados
    }
}