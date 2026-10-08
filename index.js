const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox'
        ]
    }
});
client.on('qr', qr => {
    qrcode.generate(qr, {small: true});
});
client.on('ready', () =>{
    console.log("Rodando")
})
client.on('message', msg =>{
    if(msg.body == 'noite'){
        msg.reply('boa')
    }
})

client.initialize();