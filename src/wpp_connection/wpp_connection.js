import pkg from "whatsapp-web.js"
import qrcode from "qrcode-terminal"
const { Client, LocalAuth } = pkg
import { text_to_json } from './wpp_functions.js'

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        headless: true,
        args: ['--no-sandbox','--disable-setuid-sandbox']
    }
})

client.on('qr', qr => {
    qrcode.generate(qr, {small: true});
});
client.on('ready', () =>{
    console.log("Server is running")
})
client.initialize();



client.on("message", async msg => {

    console.log("Mensagem recebida:", msg.body);

    if (msg.body === "!ping") {
        await msg.reply("pong");
        return;
    }
    try {
        const response = await text_to_json(msg.body);
        console.log("Gemini:", response);
        await msg.reply(response);
    } catch (error) {
        console.error("Erro ao processar mensagem:", error);
        await msg.reply(
            "Ocorreu um erro ao processar sua mensagem."
        );
    }
});


