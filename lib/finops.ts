// Análisis FinOps por etapa: estima costos, complejidad y recomendaciones.
// Se invoca automáticamente al aprobar cada etapa y al completar el despliegue.

import { prisma } from "./prisma";
import { callDeepSeekJSON } from "./deepseek";

export type StageForFinOps = "cim" | "pim" | "psm" | "code" | "deploy";

export interface FinOpsResult {
  summary: string;
  estimatedMonthlyCost: {
    min: number;
    max: number;
    currency: string;
    tier: string;
  };
  costDrivers: Array<{
    name: string;
    impact: "low" | "medium" | "high";
    description: string;
  }>;
  optimizations: Array<{
    priority: "low" | "medium" | "high";
    title: string;
    description: string;
    estimatedSaving?: string;
  }>;
  complexity: {
    score: number; // 1–5
    label: string;
    factors: string[];
  };
  stageInsights: string;
}

const FINOPS_SYSTEM = `Eres un experto en FinOps y estimación de costos de infraestructura cloud para aplicaciones web.
Analiza el contexto del proyecto MDD proporcionado y genera un análisis financiero estructurado.
El sistema generado usa Node.js/Express como backend, React como frontend y SQLite como base de datos,
todo empaquetado en contenedores Docker con docker-compose.

Responde ÚNICAMENTE con JSON válido que siga esta estructura exacta:
{
  "summary": "Resumen ejecutivo en 1-2 oraciones sobre la situación financiera del proyecto",
  "estimatedMonthlyCost": {
    "min": <número entero USD>,
    "max": <número entero USD>,
    "currency": "USD",
    "tier": "desarrollo local" | "VPS básico ($5-10/mes)" | "VPS mediano ($20-40/mes)" | "cloud pequeño ($50-100/mes)" | "cloud mediano ($100-300/mes)"
  },
  "costDrivers": [
    { "name": "nombre del impulsor", "impact": "low" | "medium" | "high", "description": "explicación breve" }
  ],
  "optimizations": [
    { "priority": "low" | "medium" | "high", "title": "título corto", "description": "descripción accionable", "estimatedSaving": "e.g. ~$10/mes" }
  ],
  "complexity": {
    "score": <entero 1-5>,
    "label": "Baja" | "Media" | "Alta" | "Muy alta",
    "factors": ["factor1", "factor2", "factor3"]
  },
  "stageInsights": "Observación clave específica de la etapa actual y su impacto en costos"
}

Basa el análisis en las métricas reales del modelo (número de entidades, endpoints, actores, etc.).
Sé específico y realista. Para desarrollo local el costo es $0. Para VPS hosting considera DigitalOcean/Hetzner como referencia.`;

export async function generateFinOps(
  stage: StageForFinOps,
  projectId: string
): Promise<void> {
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { cim: true, pim: true, psm: true, code: true, deployment: true },
    });
    if (!project) return;

    const userMessage = buildContext(stage, project);

    const result = await callDeepSeekJSON<FinOpsResult>(
      [{ role: "user", content: userMessage }],
      FINOPS_SYSTEM,
      { temperature: 0.2 }
    );

    await prisma.finOpsAnalysis.upsert({
      where: { projectId_stage: { projectId, stage } },
      create: { projectId, stage, content: JSON.stringify(result) },
      update: { content: JSON.stringify(result) },
    });
  } catch (e) {
    console.error(`[FinOps] Error generando análisis para etapa ${stage}:`, e);
  }
}

function buildContext(stage: StageForFinOps, project: { name: string; cim: { content: string } | null; pim: { content: string } | null; psm: { content: string } | null; code: { files: string } | null; deployment: { status: string; frontendUrl?: string | null; backendUrl?: string | null } | null }): string {
  const lines: string[] = [
    `Proyecto: "${project.name}"`,
    `Etapa a analizar: ${stage.toUpperCase()}`,
    "",
  ];

  if (project.cim?.content) {
    try {
      const cim = JSON.parse(project.cim.content) as {
        functional_requirements?: unknown[];
        non_functional_requirements?: Array<{ category?: string; type?: string }>;
        actors?: unknown[];
        use_cases?: unknown[];
      };
      const nfrTypes = (cim.non_functional_requirements ?? [])
        .map((n) => n.category || n.type || "")
        .filter(Boolean)
        .join(", ");
      lines.push("=== CIM (Requisitos formales) ===");
      lines.push(`- ${cim.functional_requirements?.length ?? 0} requisitos funcionales`);
      lines.push(`- ${cim.non_functional_requirements?.length ?? 0} requisitos no funcionales${nfrTypes ? `: ${nfrTypes}` : ""}`);
      lines.push(`- ${cim.actors?.length ?? 0} actores del sistema`);
      lines.push(`- ${cim.use_cases?.length ?? 0} casos de uso`);
      lines.push("");
    } catch { /* JSON inválido, omitir */ }
  }

  if (project.pim?.content) {
    try {
      const pim = JSON.parse(project.pim.content) as {
        entities?: Array<{ attributes?: unknown[]; relations?: Array<{ cardinality?: string }> }>;
      };
      const entities = pim.entities ?? [];
      const totalAttrs = entities.reduce((s, e) => s + (e.attributes?.length ?? 0), 0);
      const totalRels = entities.reduce((s, e) => s + (e.relations?.length ?? 0), 0);
      const nnCount = entities.reduce(
        (s, e) => s + (e.relations?.filter((r) => r.cardinality === "N-N").length ?? 0),
        0
      );
      lines.push("=== PIM (Modelo de dominio) ===");
      lines.push(`- ${entities.length} entidades de dominio`);
      lines.push(`- ${totalAttrs} atributos en total`);
      lines.push(`- ${totalRels} relaciones (${nnCount} de tipo N-N → tablas intermedias)`);
      lines.push("");
    } catch { /* JSON inválido, omitir */ }
  }

  if (project.psm?.content) {
    try {
      const psm = JSON.parse(project.psm.content) as {
        entities?: Array<{ endpoints?: unknown[]; reactComponents?: unknown[] }>;
      };
      const entities = psm.entities ?? [];
      const totalEndpoints = entities.reduce((s, e) => s + (e.endpoints?.length ?? 0), 0);
      const totalComponents = entities.reduce((s, e) => s + (e.reactComponents?.length ?? 0), 0);
      lines.push("=== PSM (Modelo específico de plataforma) ===");
      lines.push(`- ${entities.length} modelos Prisma (tablas)`);
      lines.push(`- ${totalEndpoints} endpoints REST`);
      lines.push(`- ${totalComponents} componentes React`);
      lines.push("");
    } catch { /* JSON inválido, omitir */ }
  }

  if (project.code?.files) {
    try {
      const files = JSON.parse(project.code.files) as Record<string, string>;
      const paths = Object.keys(files);
      const totalLines = Object.values(files).reduce(
        (s, c) => s + (c.split("\n").length),
        0
      );
      lines.push("=== Código generado (M2T) ===");
      lines.push(`- ${paths.length} archivos generados`);
      lines.push(`- ~${totalLines} líneas de código en total`);
      lines.push(`- Stack: Node.js/Express + Prisma + SQLite + React + Vite + Docker`);
      lines.push("");
    } catch { /* JSON inválido, omitir */ }
  }

  if (project.deployment) {
    lines.push("=== Despliegue Docker ===");
    lines.push(`- Estado: ${project.deployment.status}`);
    if (project.deployment.frontendUrl) lines.push(`- Frontend: ${project.deployment.frontendUrl}`);
    if (project.deployment.backendUrl) lines.push(`- Backend: ${project.deployment.backendUrl}`);
    lines.push("");
  }

  lines.push(`Genera el análisis FinOps enfocado en la etapa ${stage.toUpperCase()} considerando todo el contexto acumulado del pipeline.`);

  return lines.join("\n");
}
