import { Client } from "pg";
import { env } from "../Config/env";

const client = new Client({
    user: env.USER,
    password: env.password,
    host: env.host,
    port: env.port
})

await client.connect()

client.sql(querry_create_db)