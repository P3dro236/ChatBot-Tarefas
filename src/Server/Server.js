import express from "express"


const app = express()
app.use(express.json())

app.post("/task", (req, res) =>{
    //Adicionar rota para coneção o banco de dados
})
app.get("/task", (req, res) =>{
    //Adicionar rota para pegar todas as tasks
})
app.delete("task", (req, res) =>{
    //Adicionar rota para apagar uma task com base no id
})
app.patch("task", (req, res) =>{
    //Adicionar rota para editar uma task com base no id
})


app.listen()
