import qrcode from "qrcode-terminal"
import pkg from "whatsapp-web.js"
const { Client, LocalAuth } = pkg

import { msg_handler } from '../../Controller/Controller.js'

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        headless: true,
        args: ['--no-sandbox','--disable-setuid-sandbox']
    }
})

export const initialize_server = () =>{
    client.on('qr', qr => {
        qrcode.generate(qr, {small: true});
    });
    client.on('ready', () =>{
        console.log("Server is running")
    })
    client.initialize();
}

client.on("message", async msg => {
    msg_handler(msg)
});