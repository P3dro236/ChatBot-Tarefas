import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeDatabase, closePool } from "./Server/PgConnect.js";
import { startHttpServer } from "./Server/Server.js";
import { initialize_server } from "./Integrations/whatsapp/client.js";

async function closeHttpServer(httpServer) {
    if (!httpServer || typeof httpServer.close !== "function") {
        return;
    }

    await new Promise((resolve) => {
        httpServer.close(() => resolve());
        httpServer.closeIdleConnections?.();
    });
}

function normalizeFilePath(filePath) {
    const resolved = path.resolve(filePath);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isMainModule() {
    if (!process.argv[1]) {
        return false;
    }

    return (
        normalizeFilePath(process.argv[1]) ===
        normalizeFilePath(fileURLToPath(import.meta.url))
    );
}

export async function startApplication({
    initDb = initializeDatabase,
    closeDb = closePool,
    startServer = startHttpServer,
    startWhatsApp = initialize_server,
    onWhatsAppInitError,
} = {}) {
    let httpServer = null;
    let rolledBack = false;

    async function rollbackResources() {
        if (rolledBack) {
            return;
        }
        rolledBack = true;

        await closeHttpServer(httpServer);
        await closeDb().catch((closeError) => {
            console.error(
                "Erro ao encerrar conexão com o banco durante falha de startup:",
                closeError?.message ?? "Erro desconhecido"
            );
        });
    }

    try {
        await initDb();
        httpServer = await startServer();

        const whatsappClient = startWhatsApp(undefined, {
            onInitError: async (initError) => {
                await rollbackResources();
                if (typeof onWhatsAppInitError === "function") {
                    await onWhatsAppInitError(initError);
                }
            },
        });

        return { httpServer, whatsappClient };
    } catch (error) {
        await rollbackResources();
        throw error;
    }
}

function registerGracefulShutdown({ httpServer, whatsappClient }) {
    let isShuttingDown = false;

    async function shutdown(signal) {
        if (isShuttingDown) {
            return;
        }
        isShuttingDown = true;

        console.log(`Recebido ${signal}. Encerrando aplicação...`);

        try {
            if (whatsappClient && typeof whatsappClient.destroy === "function") {
                await whatsappClient.destroy();
            }
        } catch (error) {
            console.error(
                "Erro ao encerrar cliente WhatsApp:",
                error?.message ?? "Erro desconhecido"
            );
        }

        await closeHttpServer(httpServer);

        try {
            await closePool();
        } catch (error) {
            console.error(
                "Erro ao encerrar conexão com o banco:",
                error?.message ?? "Erro desconhecido"
            );
        }

        process.exit(0);
    }

    process.once("SIGINT", () => {
        shutdown("SIGINT");
    });

    process.once("SIGTERM", () => {
        shutdown("SIGTERM");
    });
}

if (isMainModule()) {
    startApplication({
        onWhatsAppInitError: () => {
            process.exit(1);
        },
    })
        .then(registerGracefulShutdown)
        .catch((error) => {
            console.error(
                "Falha ao iniciar aplicação:",
                error?.message ?? "Erro desconhecido"
            );
            process.exit(1);
        });
}
