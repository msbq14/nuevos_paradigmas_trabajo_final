// Verifica que la API key de DeepSeek funciona (PDF dia 1, paso 5).
// Uso:  node scripts/check-deepseek.mjs
import { readFileSync } from "node:fs";

function loadEnv() {
  try {
    const txt = readFileSync(new URL("../.env", import.meta.url), "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    console.error("No encontre .env (copia .env.example a .env).");
    process.exit(1);
  }
}

loadEnv();
const key = process.env.DEEPSEEK_API_KEY;
const base = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";

if (!key || key === "pon-aqui-tu-api-key") {
  console.error("DEEPSEEK_API_KEY no esta configurada en .env");
  process.exit(1);
}

console.log(`Probando DeepSeek (${model}) en ${base} ...`);
const res = await fetch(`${base}/chat/completions`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
  body: JSON.stringify({
    model,
    messages: [{ role: "user", content: "Responde solo: OK" }],
    stream: false,
  }),
});

if (!res.ok) {
  console.error("FALLO:", res.status, await res.text());
  process.exit(1);
}
const data = await res.json();
console.log("OK. Respuesta:", data.choices?.[0]?.message?.content);
console.log("API key valida. Ya puedes usar el pipeline.");
