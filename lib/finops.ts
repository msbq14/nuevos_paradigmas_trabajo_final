// ============================================================
//  Módulo FinOps del pipeline MDD.
//
//  Provee dos funciones con propósitos distintos:
//
//  1. generateStageFinOps (CIM / PIM / PSM / Código)
//     Recibe los tokens reales reportados por la API, calcula el costo y
//     luego llama a DeepSeek para producir un análisis FinOps completo:
//     eficiencia, factores que impulsaron el costo, recomendaciones para
//     reducirlo y proyección mensual. Guarda el resultado con kind = "ai_cost".
//     Para la etapa Código (M2T sin IA) genera un análisis estático sin
//     llamada adicional al LLM.
//
//  2. generateFinOps (Deploy)
//     Llama a DeepSeek con el contexto completo del pipeline para producir
//     un análisis de infraestructura y costo cloud del sistema desplegado.
//     Guarda el resultado con kind = "full_finops".
//
//  Ambos resultados se persisten en FinOpsAnalysis, diferenciados por el
//  campo `stage` y el discriminador `kind` del JSON almacenado.
// ============================================================

import { prisma } from "./prisma";
import { callDeepSeekJSON } from "./deepseek";

// ─── Precios deepseek-chat v3 (cache miss, referencia oficial julio 2025) ────
// Si el modelo cambia (DEEPSEEK_MODEL env), estos valores pueden no ser exactos;
// sirven como estimación conservadora.
const PRICE_INPUT_PER_1M  = 0.27;   // USD / 1M tokens de entrada
const PRICE_OUTPUT_PER_1M = 1.10;   // USD / 1M tokens de salida

// Proyección estándar: cuántas veces al mes se ejecuta el pipeline completo.
const MONTHLY_RUNS = 30;

// ─── Tipos públicos ──────────────────────────────────────────────────────────

/**
 * Análisis FinOps completo de una etapa que usa IA (CIM/PIM/PSM).
 * Combina los datos brutos de la API con el análisis generado por DeepSeek.
 */
export interface AICostResult {
  kind: "ai_cost";
  // Datos brutos reportados por la API
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUSD: number;
  apiCalls: number;
  priceInputPer1M: number;
  priceOutputPer1M: number;
  // Análisis FinOps generado por DeepSeek (o estático para etapas sin IA)
  efficiencyScore: number;          // 1 (muy ineficiente) – 5 (muy eficiente)
  efficiencyLabel: string;
  costDrivers: Array<{
    factor: string;
    impact: "low" | "medium" | "high";
    detail: string;
  }>;
  recommendations: Array<{
    priority: "low" | "medium" | "high";
    title: string;
    detail: string;
  }>;
  monthlyProjection: {
    runsPerMonth: number;
    costUSD: number;
  };
  insight: string;
  note?: string;                    // presente cuando apiCalls === 0 (etapa sin IA)
}

/** Análisis FinOps de infraestructura cloud generado para el despliegue. */
export interface FinOpsResult {
  kind: "full_finops";
  summary: string;
  estimatedMonthlyCost: { min: number; max: number; currency: string; tier: string };
  costDrivers: Array<{ name: string; impact: "low" | "medium" | "high"; description: string }>;
  optimizations: Array<{ priority: "low" | "medium" | "high"; title: string; description: string; estimatedSaving?: string }>;
  complexity: { score: number; label: string; factors: string[] };
  stageInsights: string;
}

export type StageFinOps = AICostResult | FinOpsResult;

/**
 * Resumen de tokens acumulados en una o varias llamadas a DeepSeek.
 * Lo construye `generateValidated` en pipeline.ts.
 */
export type UsageSummary = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  apiCalls: number;
};

// ─── Nombres de etapas para el prompt ────────────────────────────────────────
const STAGE_NAMES: Record<string, string> = {
  cim: "CIM (Conceptual Information Model — formalización de requisitos en lenguaje natural a JSON estructurado)",
  pim: "PIM (Platform Independent Model — transformación M2M del CIM a modelo de dominio con entidades y relaciones)",
  psm: "PSM (Platform Specific Model — enriquecimiento del modelo con endpoints REST y componentes React)",
};

// ─── Prompt del análisis FinOps de IA ────────────────────────────────────────
const STAGE_FINOPS_SYSTEM = `Eres un experto en FinOps para servicios de inteligencia artificial generativa.
Tu tarea es analizar el consumo de tokens de una llamada a la API de DeepSeek dentro de un pipeline MDD
y producir un análisis financiero accionable.

Responde ÚNICAMENTE con JSON válido con esta estructura:
{
  "efficiencyScore": <entero 1-5>,
  "efficiencyLabel": "Muy eficiente" | "Eficiente" | "Aceptable" | "Mejorable" | "Ineficiente",
  "costDrivers": [
    { "factor": "nombre del factor", "impact": "low"|"medium"|"high", "detail": "explicación concreta" }
  ],
  "recommendations": [
    { "priority": "low"|"medium"|"high", "title": "título corto", "detail": "acción concreta para reducir el costo" }
  ],
  "monthlyProjection": { "runsPerMonth": <número>, "costUSD": <número con 6 decimales> },
  "insight": "Una observación clave sobre la eficiencia de esta etapa en una sola oración"
}

Considera como factores de costo: longitud del historial de conversación, número de reintentos por
validación del metamodelo, complejidad del JSON generado, verbosidad del prompt de sistema.
Sé específico y accionable en las recomendaciones. Usa siempre español.`;

// ─── 1. Análisis FinOps de IA por etapa ──────────────────────────────────────

/**
 * Calcula el costo de la etapa con los tokens reportados por la API y luego
 * invoca a DeepSeek para producir el análisis FinOps completo (eficiencia,
 * factores, recomendaciones, proyección mensual).
 * Para la etapa Código (apiCalls === 0) genera un resultado estático sin
 * llamada adicional al LLM.
 */
export async function generateStageFinOps(
  stage: "cim" | "pim" | "psm" | "code",
  projectId: string,
  usage: UsageSummary
): Promise<void> {
  try {
    const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";
    const costUSD =
      (usage.promptTokens  / 1_000_000) * PRICE_INPUT_PER_1M +
      (usage.completionTokens / 1_000_000) * PRICE_OUTPUT_PER_1M;

    let analysisFields: Omit<AICostResult,
      "kind" | "model" | "promptTokens" | "completionTokens" |
      "totalTokens" | "costUSD" | "apiCalls" | "priceInputPer1M" | "priceOutputPer1M"
    >;

    if (usage.apiCalls === 0) {
      // Etapa Código: transformación determinista, sin IA → análisis estático.
      analysisFields = {
        efficiencyScore: 5,
        efficiencyLabel: "Óptimo",
        costDrivers: [],
        recommendations: [],
        monthlyProjection: { runsPerMonth: MONTHLY_RUNS, costUSD: 0 },
        insight:
          "Esta etapa no consume tokens de IA: la generación de código es una " +
          "transformación M2T completamente determinista a partir del PSM.",
        note: "Transformación determinista (M2T): sin llamadas a la API de IA.",
      };
    } else {
      // Etapas CIM/PIM/PSM: análisis generado por DeepSeek.
      const userMessage = buildStageContext(stage, usage, costUSD, model);
      const { data } = await callDeepSeekJSON<typeof analysisFields>(
        [{ role: "user", content: userMessage }],
        STAGE_FINOPS_SYSTEM,
        { temperature: 0.3 }
      );
      // Forzar la proyección mensual con el costo real calculado.
      analysisFields = {
        ...data,
        monthlyProjection: {
          runsPerMonth: MONTHLY_RUNS,
          costUSD: parseFloat((costUSD * MONTHLY_RUNS).toFixed(6)),
        },
      };
    }

    const result: AICostResult = {
      kind: "ai_cost",
      model: usage.apiCalls === 0 ? "none" : model,
      promptTokens:     usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens:      usage.totalTokens,
      costUSD,
      apiCalls:         usage.apiCalls,
      priceInputPer1M:  PRICE_INPUT_PER_1M,
      priceOutputPer1M: PRICE_OUTPUT_PER_1M,
      ...analysisFields,
    };

    await prisma.finOpsAnalysis.upsert({
      where:  { projectId_stage: { projectId, stage } },
      create: { projectId, stage, content: JSON.stringify(result) },
      update: { content: JSON.stringify(result) },
    });
  } catch (e) {
    console.error(`[FinOps] Error en análisis de etapa ${stage}:`, e);
  }
}

/** Construye el mensaje de usuario para el análisis FinOps de una etapa. */
function buildStageContext(
  stage: string,
  usage: UsageSummary,
  costUSD: number,
  model: string
): string {
  const lines = [
    `Etapa analizada: ${STAGE_NAMES[stage] ?? stage.toUpperCase()}`,
    `Modelo de IA: ${model}`,
    ``,
    `=== Consumo de tokens ===`,
    `- Tokens de entrada (prompt):   ${usage.promptTokens.toLocaleString("es")}`,
    `- Tokens de salida (respuesta): ${usage.completionTokens.toLocaleString("es")}`,
    `- Total de tokens:              ${usage.totalTokens.toLocaleString("es")}`,
    `- Llamadas a la API:            ${usage.apiCalls}${usage.apiCalls > 1 ? " (incluye reintentos por validación de metamodelo)" : ""}`,
    ``,
    `=== Costo ===`,
    `- Costo de esta ejecución:  $${costUSD.toFixed(6)} USD`,
    `- Precio entrada:  $${PRICE_INPUT_PER_1M}/1M tokens`,
    `- Precio salida:   $${PRICE_OUTPUT_PER_1M}/1M tokens`,
    ``,
    `Genera el análisis FinOps de esta etapa del pipeline MDD con ${MONTHLY_RUNS} ejecuciones/mes como referencia.`,
  ];
  return lines.join("\n");
}

// ─── 2. Análisis FinOps completo para el despliegue (usa DeepSeek) ───────────

/**
 * Genera un análisis FinOps de infraestructura cloud usando DeepSeek como LLM.
 * Solo se invoca cuando el despliegue Docker termina con éxito (status = "running").
 * Recibe el contexto completo del pipeline (CIM→PIM→PSM→Código→Deploy) para
 * que el análisis refleje la complejidad real del sistema generado.
 */
const FINOPS_SYSTEM = `Eres un experto en FinOps y estimación de costos de infraestructura cloud para aplicaciones web.
Analiza el contexto del proyecto MDD proporcionado y genera un análisis financiero estructurado.
El sistema generado usa Node.js/Express como backend, React como frontend y SQLite como base de datos,
todo empaquetado en contenedores Docker con docker-compose.

Responde ÚNICAMENTE con JSON válido que siga esta estructura exacta:
{
  "kind": "full_finops",
  "summary": "Resumen ejecutivo en 1-2 oraciones sobre la situación financiera del proyecto",
  "estimatedMonthlyCost": {
    "min": <número entero USD>,
    "max": <número entero USD>,
    "currency": "USD",
    "tier": "desarrollo local" | "VPS básico ($5-10/mes)" | "VPS mediano ($20-40/mes)" | "cloud pequeño ($50-100/mes)"
  },
  "costDrivers": [
    { "name": "...", "impact": "low"|"medium"|"high", "description": "..." }
  ],
  "optimizations": [
    { "priority": "low"|"medium"|"high", "title": "...", "description": "...", "estimatedSaving": "..." }
  ],
  "complexity": { "score": <1-5>, "label": "Baja"|"Media"|"Alta"|"Muy alta", "factors": ["..."] },
  "stageInsights": "Observación clave sobre el costo de infraestructura de este sistema desplegado"
}

Basa el análisis en las métricas reales del modelo. Considera DigitalOcean/Hetzner como referencia de precios.`;

export async function generateFinOps(
  stage: "deploy",
  projectId: string
): Promise<void> {
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { cim: true, pim: true, psm: true, code: true, deployment: true },
    });
    if (!project) return;

    const { data: result } = await callDeepSeekJSON<FinOpsResult>(
      [{ role: "user", content: buildDeployContext(project) }],
      FINOPS_SYSTEM,
      { temperature: 0.2 }
    );

    const content = JSON.stringify({ ...result, kind: "full_finops" as const });
    await prisma.finOpsAnalysis.upsert({
      where:  { projectId_stage: { projectId, stage } },
      create: { projectId, stage, content },
      update: { content },
    });
  } catch (e) {
    console.error("[FinOps] Error generando análisis de despliegue:", e);
  }
}

function buildDeployContext(project: {
  name: string;
  cim: { content: string } | null;
  pim: { content: string } | null;
  psm: { content: string } | null;
  code: { files: string } | null;
  deployment: { status: string; frontendUrl?: string | null; backendUrl?: string | null } | null;
}): string {
  const lines: string[] = [`Proyecto: "${project.name}"`, ""];

  if (project.cim?.content) {
    try {
      const cim = JSON.parse(project.cim.content) as {
        functional_requirements?: unknown[];
        non_functional_requirements?: unknown[];
        actors?: unknown[];
        use_cases?: unknown[];
      };
      lines.push("=== CIM ===");
      lines.push(`- ${cim.functional_requirements?.length ?? 0} requisitos funcionales`);
      lines.push(`- ${cim.non_functional_requirements?.length ?? 0} requisitos no funcionales`);
      lines.push(`- ${cim.actors?.length ?? 0} actores, ${cim.use_cases?.length ?? 0} casos de uso`);
      lines.push("");
    } catch { /* ignorar */ }
  }

  if (project.pim?.content) {
    try {
      const pim = JSON.parse(project.pim.content) as {
        entities?: Array<{ attributes?: unknown[]; relations?: unknown[] }>;
      };
      const entities = pim.entities ?? [];
      lines.push("=== PIM ===");
      lines.push(`- ${entities.length} entidades, ${entities.reduce((s, e) => s + (e.relations?.length ?? 0), 0)} relaciones`);
      lines.push("");
    } catch { /* ignorar */ }
  }

  if (project.psm?.content) {
    try {
      const psm = JSON.parse(project.psm.content) as {
        entities?: Array<{ endpoints?: unknown[]; reactComponents?: unknown[] }>;
      };
      const entities = psm.entities ?? [];
      lines.push("=== PSM ===");
      lines.push(`- ${entities.reduce((s, e) => s + (e.endpoints?.length ?? 0), 0)} endpoints REST`);
      lines.push(`- ${entities.reduce((s, e) => s + (e.reactComponents?.length ?? 0), 0)} componentes React`);
      lines.push("");
    } catch { /* ignorar */ }
  }

  if (project.code?.files) {
    try {
      const files = JSON.parse(project.code.files) as Record<string, string>;
      lines.push("=== Código generado ===");
      lines.push(`- ${Object.keys(files).length} archivos, stack: Node.js/Express + React + Prisma + SQLite + Docker`);
      lines.push("");
    } catch { /* ignorar */ }
  }

  if (project.deployment) {
    lines.push("=== Despliegue ===");
    lines.push(`- Estado: ${project.deployment.status}`);
    if (project.deployment.frontendUrl) lines.push(`- Frontend: ${project.deployment.frontendUrl}`);
    if (project.deployment.backendUrl)  lines.push(`- Backend: ${project.deployment.backendUrl}`);
  }

  return lines.join("\n");
}
