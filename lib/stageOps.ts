// Helpers de la maquina de estados de etapas (PDF: avanzar solo si N esta approved).

import { prisma } from "./prisma";
import { generateCIM, generatePIM, generatePSM, generateCode } from "./pipeline";
import { validateModel, type ValidationResult } from "./validate";
import { generateFinOps } from "./finops";

export type StageName = "cim" | "pim" | "psm" | "code";

export const STAGE_NUMBER: Record<StageName, number> = {
  cim: 2,
  pim: 3,
  psm: 4,
  code: 5,
};

export function isStageName(s: string): s is StageName {
  return s === "cim" || s === "pim" || s === "psm" || s === "code";
}

export async function generateStage(stage: StageName, projectId: string) {
  switch (stage) {
    case "cim":
      return generateCIM(projectId);
    case "pim":
      return generatePIM(projectId);
    case "psm":
      return generatePSM(projectId);
    case "code":
      return generateCode(projectId);
  }
}

async function setStatus(
  stage: StageName,
  projectId: string,
  status: string,
  approvedAt: Date | null
) {
  const data = { status, approvedAt };
  switch (stage) {
    case "cim":
      return prisma.cIMModel.update({ where: { projectId }, data });
    case "pim":
      return prisma.pIMModel.update({ where: { projectId }, data });
    case "psm":
      return prisma.pSMModel.update({ where: { projectId }, data });
    case "code":
      return prisma.generatedCode.update({ where: { projectId }, data });
  }
}

export async function approveStage(stage: StageName, projectId: string) {
  await setStatus(stage, projectId, "approved", new Date());
  // Desbloquea la siguiente etapa.
  const next = STAGE_NUMBER[stage] + 1;
  await prisma.project.update({
    where: { id: projectId },
    data: { currentStage: next },
  });
  // Genera el análisis FinOps; se awaita para que esté disponible al recargar el estado.
  await generateFinOps(stage, projectId);
}

export async function rejectStage(stage: StageName, projectId: string) {
  await setStatus(stage, projectId, "rejected", null);
}

/**
 * Edita el contenido de una etapa. Para cim/pim/psm, revalida contra su
 * metamodelo antes de guardar (PDF: "no saltarse la validacion del
 * metamodelo antes de guardar en DB" aplica tambien a ediciones manuales).
 */
export async function updateStageContent(
  stage: StageName,
  projectId: string,
  content: string
): Promise<ValidationResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    return { ok: false, errors: `JSON invalido: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (stage === "cim" || stage === "pim" || stage === "psm") {
    const result = validateModel(stage, parsed);
    if (!result.ok) return result;
  }

  switch (stage) {
    case "cim":
      await prisma.cIMModel.update({ where: { projectId }, data: { content } });
      break;
    case "pim":
      await prisma.pIMModel.update({ where: { projectId }, data: { content } });
      break;
    case "psm":
      await prisma.pSMModel.update({ where: { projectId }, data: { content } });
      break;
    case "code":
      await prisma.generatedCode.update({ where: { projectId }, data: { files: content } });
      break;
  }
  return { ok: true };
}
