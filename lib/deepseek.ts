// Cliente DeepSeek reutilizable (PDF: Persona 1 - lib/deepseek.ts).
// DeepSeek es compatible con la API de OpenAI, asi que usamos fetch directo.
//
// Cambio FinOps: callDeepSeek y callDeepSeekJSON ahora devuelven el campo
// `usage` de la respuesta (prompt_tokens / completion_tokens / total_tokens).
// El pipeline los acumula para calcular el costo real de IA por etapa sin
// necesitar una llamada extra al LLM.

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

/**
 * Tokens consumidos en una llamada a DeepSeek, tal como los reporta la API.
 * Se usa en el módulo FinOps para calcular el costo real de cada etapa.
 */
export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

const BASE_URL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
const MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";

export class DeepSeekError extends Error {}

/**
 * Llama a DeepSeek y devuelve el texto de la respuesta junto con el uso de tokens.
 * @param messages   historial de conversacion
 * @param systemPrompt prompt de sistema (rol del modelo)
 * @param opts.json  fuerza salida JSON (response_format json_object)
 * @returns `content` con el texto generado y `usage` con los tokens consumidos
 */
export async function callDeepSeek(
  messages: ChatMessage[],
  systemPrompt: string,
  opts: { json?: boolean; temperature?: number } = {}
): Promise<{ content: string; usage: TokenUsage }> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey || apiKey === "pon-aqui-tu-api-key") {
    throw new DeepSeekError(
      "Falta DEEPSEEK_API_KEY. Copia .env.example a .env y pon tu API key."
    );
  }

  const fullMessages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...messages,
  ];

  const body: Record<string, unknown> = {
    model: MODEL,
    messages: fullMessages,
    temperature: opts.temperature ?? 0.3,
    stream: false,
  };
  if (opts.json) {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new DeepSeekError(
      `DeepSeek respondio ${res.status}: ${text.slice(0, 500)}`
    );
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new DeepSeekError("Respuesta de DeepSeek sin contenido de texto.");
  }
  const usage: TokenUsage = {
    promptTokens: data?.usage?.prompt_tokens ?? 0,
    completionTokens: data?.usage?.completion_tokens ?? 0,
    totalTokens: data?.usage?.total_tokens ?? 0,
  };
  return { content, usage };
}

/**
 * Llama a DeepSeek esperando JSON estructurado.
 * Limpia fences ```json, parsea el resultado y devuelve también el uso de tokens
 * para que el pipeline pueda acumular el costo de IA por etapa.
 */
export async function callDeepSeekJSON<T = unknown>(
  messages: ChatMessage[],
  systemPrompt: string,
  opts: { temperature?: number } = {}
): Promise<{ data: T; usage: TokenUsage }> {
  const { content, usage } = await callDeepSeek(messages, systemPrompt, {
    json: true,
    temperature: opts.temperature,
  });
  return { data: parseJsonLoose<T>(content), usage };
}

/** Parsea JSON tolerando fences de markdown y texto alrededor. */
export function parseJsonLoose<T = unknown>(raw: string): T {
  let s = raw.trim();
  // quitar fences ```json ... ```
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // tomar desde el primer { o [ hasta el ultimo } o ]
  const firstObj = s.search(/[{[]/);
  if (firstObj > 0) s = s.slice(firstObj);
  const lastObj = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  if (lastObj >= 0) s = s.slice(0, lastObj + 1);
  return JSON.parse(s) as T;
}
