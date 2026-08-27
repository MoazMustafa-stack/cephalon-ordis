import { buildServer } from "./server.js";
import { PgStore } from "./store.js";

const databaseUrl = process.env.ORDIS_DATABASE_URL;
if (!databaseUrl) throw new Error("ORDIS_DATABASE_URL is required");
const app = buildServer(PgStore.connect(databaseUrl));
await app.listen({ host: process.env.ORDIS_BIND_HOST ?? "127.0.0.1", port: Number(process.env.ORDIS_PORT ?? 4310) });
