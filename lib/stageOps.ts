// Helpers de la maquina de estados de etapas (PDF: avanzar solo si N esta approved).

import { prisma } from "./prisma";
import { generateCIM, generatePIM, generatePSM, generateCode } from "./pipeline";

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
}

export async function rejectStage(stage: StageName, projectId: string) {
  await setStatus(stage, projectId, "rejected", null);
}

export async function updateStageContent(
  stage: StageName,
  projectId: string,
  content: string
) {
  switch (stage) {
    case "cim":
      return prisma.cIMModel.update({ where: { projectId }, data: { content } });
    case "pim":
      return prisma.pIMModel.update({ where: { projectId }, data: { content } });
    case "psm":
      return prisma.pSMModel.update({ where: { projectId }, data: { content } });
    case "code":
      return prisma.generatedCode.update({ where: { projectId }, data: { files: content } });
  }
}
