import qrcode from "qrcode-terminal";
import pkg from "whatsapp-web.js";
import { getEnv } from "../../config/env.js";
import { msg_handler } from "../../Controller/Controller.js";

const { Client, LocalAuth } = pkg;

function buildPuppeteerConfig(executablePath) {
    const config = {
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
    };

    if (executablePath) {
        config.executablePath = executablePath;
    }

    return config;
}

function registerClientListeners(client, onMessage) {
    client.on("qr", (qr) => {
        qrcode.generate(qr, { small: true });
    });

    client.on("ready", () => {
        console.log("Server is running");
    });

    client.on("auth_failure", (message) => {
        console.error("Falha na autenticação do WhatsApp:", message);
    });

    client.on("disconnected", (reason) => {
        console.warn("Cliente WhatsApp desconectado:", reason);
    });

    client.on("message", async (msg) => {
        try {
            await onMessage(msg);
        } catch (error) {
            console.error(
                "Erro não tratado ao processar evento message:",
                error?.message ?? "Erro desconhecido"
            );
        }
    });
}

export function createWhatsAppClient({
    onMessage = msg_handler,
    executablePath,
} = {}) {
    const resolvedExecutablePath =
        executablePath !== undefined
            ? executablePath
            : getEnv().CHROME_EXECUTABLE_PATH;

    const client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: buildPuppeteerConfig(resolvedExecutablePath),
    });

    registerClientListeners(client, onMessage);
    return client;
}

export function initialize_server(
    onMessage = msg_handler,
    { onInitError, executablePath } = {}
) {
    const client = createWhatsAppClient({ onMessage, executablePath });

    client.initPromise = Promise.resolve()
        .then(() => client.initialize())
        .catch(async (error) => {
            console.error(
                "Erro ao inicializar cliente WhatsApp:",
                error?.message ?? "Erro desconhecido"
            );

            if (typeof onInitError === "function") {
                try {
                    await onInitError(error);
                } catch (callbackError) {
                    console.error(
                        "Erro no tratamento de falha do cliente WhatsApp:",
                        callbackError?.message ?? "Erro desconhecido"
                    );
                }
            }
        });

    return client;
}
