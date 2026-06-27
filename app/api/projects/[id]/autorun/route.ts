import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateStage, approveStage, type StageName } from "@/lib/stageOps";
import { composeUp, portsFor, writeFiles } from "@/lib/deploy";
import type { FileTree } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

// POST /api/projects/:id/autorun
// Ejecuta automaticamente CIM -> PIM -> PSM -> Codigo (genera + auto-aprueba)
// y luego lanza el despliegue Docker en background.
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const projectId = params.id;

  const messages = await prisma.requirementMessage.findMany({
    where: { projectId },
  });
  if (messages.length === 0) {
    return NextResponse.json(
      { error: "Primero describe el sistema en el chat (al menos un mensaje)." },
      { status: 400 }
    );
  }

  const stages: StageName[] = ["cim", "pim", "psm", "code"];
  const log: string[] = [];
  try {
    for (const stage of stages) {
      await generateStage(stage, projectId);
      await approveStage(stage, projectId);
      log.push(`${stage.toUpperCase()} generado y aprobado`);
    }
  } catch (e) {
    return NextResponse.json(
      { error: String(e instanceof Error ? e.message : e), log },
      { status: 500 }
    );
  }

  // Lanzar despliegue (igual que la ruta /deploy, en background).
  const code = await prisma.generatedCode.findUnique({ where: { projectId } });
  const files = JSON.parse(code!.files) as FileTree;
  const { frontendPort, backendPort } = portsFor(projectId);
  await writeFiles(projectId, files);

  await prisma.deployment.upsert({
    where: { projectId },
    create: {
      projectId,
      status: "building",
      logs: "Auto-run: construyendo imagenes Docker...\n",
      frontendUrl: `http://localhost:${frontendPort}`,
      backendUrl: `http://localhost:${backendPort}`,
    },
    update: {
      status: "building",
      logs: "Auto-run: construyendo imagenes Docker...\n",
      frontendUrl: `http://localhost:${frontendPort}`,
      backendUrl: `http://localhost:${backendPort}`,
    },
  });

  (async () => {
    let logBuffer = "";
    const result = await composeUp(projectId, (c) => {
      logBuffer += c;
    });
    await prisma.deployment.update({
      where: { projectId },
      data: {
        status: result.code === 0 ? "running" : "failed",
        logs: logBuffer.slice(-8000),
      },
    });
    if (result.code === 0) {
      await prisma.project.update({
        where: { id: projectId },
        data: { currentStage: 6 },
      });
    }
  })().catch(() => {});

  return NextResponse.json({ ok: true, log, status: "building", frontendPort, backendPort });
}
