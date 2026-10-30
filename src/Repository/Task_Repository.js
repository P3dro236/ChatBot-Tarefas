export const atividade_schema = {
    type: "object",
    properties: {
        titulo: {
            type: "string",
            description: "Título conciso ou nome da atividade (ex: 'Prova de Cálculo', 'Resumo do Capítulo 3')."
        },
        materia: {
            type: ["string", "null"],
            description: "Nome da disciplina ou matéria relacionada. Null se não puder ser inferido."
        },
        tipo: {
            type: "string",
            enum: ["trabalho", "prova", "apresentacao", "leitura", "exercicio", "outro"],
            description: "Categoria principal da atividade."
        },
        data_entrega: {
            type: ["string", "null"],
            description: "Data de entrega ou de realização no formato YYYY-MM-DD. Calcular datas relativas com base na data atual. Null se não informado."
        },
        observacoes: {
            type: ["string", "null"],
            description: "Qualquer detalhe extra e relevante da mensagem (ex: 'em grupo de 4 pessoas', 'páginas 10 a 50', 'peso 2 na média'). Null se não houver."
        },
        nota:{
            type: ["number", "null"],
            description: "A nota declarada pelo usuário para o valor da atividade, o valor numerico deve obrigatoriamente estar descrito aqui, e nao em outros lugares como observacoes, podendo ser tanto inteira tanto conter valores com virgula (ex: 3.5, 12, 15). Null se não houver."
        },
        sucesso:{
            type: "boolean",
            descruption: "Caso a mensagem não faça sentido com a proposta de sua função, ou caso o entendimento geral não seja feito, deve retornar como false, em caso de compreensão da mensagem e correta tradução para json o valor deve ser true. Caso uma das informações obrigatorias dentro de required for vazio, deve retornar o valor como false"
        },
        retorno:{
            type: ["string","null"],
            description: "Caso o sucesso seja falso, deve deixar uma mensagem de porque o erro aconteceu ou qual campo obrigatorio esta em branco (EX: qual a materia? , qual a data?), deixe um erro detalhado, caso tenha faltado algum campo deixe claro qual campo faltou, caso o sucesso seja true então o valor deve ser null EX(Não consegui entender, repita por favor.), faça o possível para agir como uma conversa normal, seja despojado e o mais curto possivel, fazendo com que a mensagem seja entendida corretamente"
        }
    },
    required: [
        "titulo",
        "materia",
        "tipo",
        "data_entrega"
    ]
}