import { mkdirSync, openSync, closeSync, readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

const env = existsSync(".env") ? readFileSync(".env", "utf8") : "";
const match = env.match(/^DATABASE_URL\s*=\s*['"]?([^'"\r\n]+)['"]?/m);
const databaseUrl = match?.[1] || "file:./dev.db";

if (!databaseUrl.startsWith("file:")) {
  process.exit(0);
}

const rawPath = databaseUrl.slice("file:".length);
const dbPath = rawPath.startsWith("/")
  ? rawPath
  : resolve("prisma", rawPath);

mkdirSync(dirname(dbPath), { recursive: true });
closeSync(openSync(dbPath, "a"));
