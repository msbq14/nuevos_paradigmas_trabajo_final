// ============================================================
//  Orquestacion del pipeline MDD.
//  Cada funcion genera un artefacto de etapa, validandolo contra
//  su metamodelo y reintentando con DeepSeek si falla (max 3).
//
//  FinOps: al finalizar cada etapa se llama a generateStageFinOps()
//  con el total de tokens acumulados. Esa función calcula el costo
//  y luego llama a DeepSeek para producir un análisis completo
//  (eficiencia, factores, recomendaciones, proyección mensual).
//  La etapa Código (M2T) genera un análisis estático sin IA.
// ============================================================

import { prisma } from "./prisma";
import { callDeepSeekJSON, parseJsonLoose, type ChatMessage } from "./deepseek";
import {
  CIM_GENERATOR,
  PIM_GENERATOR,
  PSM_ENRICHER,
  retryHint,
} from "./prompts";
import { validateModel } from "./validate";
import { pimToPsm } from "./transform/pimToPsm";
import { psmToCode } from "./transform/psmToCode";
import { portsFor } from "./deploy";
import type { PIM, PSM } from "./types";
import { generateStageFinOps, type UsageSummary } from "./finops";

const MAX_RETRIES = 3;

/**
 * Llama a DeepSeek y reintenta hasta que la salida valide contra el metamodelo.
 * Acumula el uso de tokens de TODOS los intentos (incluidos los reintentos por
 * error de validacion) para reflejar el costo real de la generacion en FinOps.
 */
async function generateValidated<T>(
  kind: "cim" | "pim" | "psm",
  systemPrompt: string,
  userContent: string
): Promise<{ data: T; usage: UsageSummary }> {
  let messages: ChatMessage[] = [{ role: "user", content: userContent }];
  let lastErrors = "";
  const usage: UsageSummary = { promptTokens: 0, completionTokens: 0, totalTokens: 0, apiCalls: 0 };

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const { data, usage: u } = await callDeepSeekJSON<T>(messages, systemPrompt);
    usage.promptTokens     += u.promptTokens;
    usage.completionTokens += u.completionTokens;
    usage.totalTokens      += u.totalTokens;
    usage.apiCalls++;

    const result = validateModel(kind, data);
    if (result.ok) return { data, usage };

    lastErrors = result.errors;
    messages = [
      { role: "user", content: userContent },
      { role: "assistant", content: JSON.stringify(data) },
      { role: "user", content: retryHint(lastErrors) },
    ];
  }
  throw new Error(
    `La salida del LLM no cumplio el metamodelo ${kind.toUpperCase()} tras ${MAX_RETRIES} intentos:\n${lastErrors}`
  );
}

// -------------------- Etapa 2: CIM --------------------
export async function generateCIM(projectId: string) {
  const messages = await prisma.requirementMessage.findMany({
    where: { projectId },
    orderBy: { order: "asc" },
  });
  const transcript = messages
    .map((m) => `${m.role === "user" ? "Usuario" : "Analista"}: ${m.content}`)
    .join("\n");

  const { data: cim, usage } = await generateValidated<unknown>(
    "cim",
    CIM_GENERATOR,
    `Conversacion de requisitos:\n\n${transcript}\n\nGenera el CIM.`
  );

  await prisma.cIMModel.upsert({
    where: { projectId },
    create: { projectId, content: JSON.stringify(cim), status: "pending" },
    update: { content: JSON.stringify(cim), status: "pending", approvedAt: null },
  });

  await generateStageFinOps("cim", projectId, usage);
  return cim;
}

// -------------------- Etapa 3: PIM (M2M via LLM) --------------------
export async function generatePIM(projectId: string) {
  const cim = await prisma.cIMModel.findUnique({ where: { projectId } });
  if (!cim || cim.status !== "approved") {
    throw new Error("El CIM debe estar aprobado antes de generar el PIM.");
  }

  const { data: pim, usage } = await generateValidated<PIM>(
    "pim",
    PIM_GENERATOR,
    `CIM aprobado:\n\n${cim.content}\n\nTransforma este CIM en un PIM (M2M).`
  );

  await prisma.pIMModel.upsert({
    where: { projectId },
    create: { projectId, content: JSON.stringify(pim), status: "pending" },
    update: { content: JSON.stringify(pim), status: "pending", approvedAt: null },
  });

  await generateStageFinOps("pim", projectId, usage);
  return pim;
}

// -------------------- Etapa 4: PSM (M2M programatico + enriquecimiento) --------------------
export async function generatePSM(projectId: string) {
  const pimRow = await prisma.pIMModel.findUnique({ where: { projectId } });
  if (!pimRow || pimRow.status !== "approved") {
    throw new Error("El PIM debe estar aprobado antes de generar el PSM.");
  }

  const pim = JSON.parse(pimRow.content) as PIM;
  const psm: PSM = pimToPsm(pim);

  // Acumula tokens del enriquecimiento LLM (best-effort; puede quedarse en ceros si falla).
  const usage: UsageSummary = { promptTokens: 0, completionTokens: 0, totalTokens: 0, apiCalls: 0 };

  // Enriquecimiento LLM opcional: endpoints de lógica de negocio.
  try {
    const cimRow = await prisma.cIMModel.findUnique({ where: { projectId } });
    const { data: enrich, usage: u } = await callDeepSeekJSON<{
      extraEndpoints?: { entity: string; method: string; path: string; description?: string }[];
    }>(
      [
        {
          role: "user",
          content: `Contexto CIM:\n${cimRow?.content ?? ""}\n\nPIM:\n${pimRow.content}\n\nPropon endpoints de logica de negocio adicionales.`,
        },
      ],
      PSM_ENRICHER
    );
    usage.promptTokens     += u.promptTokens;
    usage.completionTokens += u.completionTokens;
    usage.totalTokens      += u.totalTokens;
    usage.apiCalls++;

    for (const ep of enrich.extraEndpoints || []) {
      const target = psm.entities.find((e) => e.name === ep.entity);
      if (target) {
        target.endpoints.push({
          method: ep.method,
          path: ep.path,
          description: ep.description,
        });
      }
    }
  } catch {
    // El enriquecimiento es best-effort; si falla, el CRUD base ya es valido.
  }

  const result = validateModel("psm", psm);
  if (!result.ok) {
    throw new Error("El PSM generado no cumple el metamodelo:\n" + result.errors);
  }

  await prisma.pSMModel.upsert({
    where: { projectId },
    create: { projectId, content: JSON.stringify(psm), status: "pending" },
    update: { content: JSON.stringify(psm), status: "pending", approvedAt: null },
  });

  await generateStageFinOps("psm", projectId, usage);
  return psm;
}

// -------------------- Etapa 5: Codigo (M2T determinista) --------------------
export async function generateCode(projectId: string) {
  const psmRow = await prisma.pSMModel.findUnique({ where: { projectId } });
  if (!psmRow || psmRow.status !== "approved") {
    throw new Error("El PSM debe estar aprobado antes de generar el codigo.");
  }
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  const psm = JSON.parse(psmRow.content) as PSM;
  const { frontendPort, backendPort } = portsFor(projectId);

  const files = psmToCode(psm, {
    projectName: project?.name || "app",
    frontendPort,
    backendPort,
  });

  await prisma.generatedCode.upsert({
    where: { projectId },
    create: { projectId, files: JSON.stringify(files), status: "pending" },
    update: { files: JSON.stringify(files), status: "pending", approvedAt: null },
  });

  // Transformación determinista: sin llamadas a IA, costo $0.
  await generateStageFinOps("code", projectId, { promptTokens: 0, completionTokens: 0, totalTokens: 0, apiCalls: 0 });
  return files;
}
