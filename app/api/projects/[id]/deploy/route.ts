import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { composeUp, portsFor, writeFiles } from "@/lib/deploy";
import type { FileTree } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

// GET -> estado actual del despliegue (para polling de la UI)
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const dep = await prisma.deployment.findUnique({ where: { projectId: params.id } });
  return NextResponse.json(dep ?? { status: "idle" });
}

// POST -> escribe los archivos y lanza docker compose up (en background).
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const projectId = params.id;
  const code = await prisma.generatedCode.findUnique({ where: { projectId } });
  if (!code || code.status !== "approved") {
    return NextResponse.json(
      { error: "El codigo debe estar aprobado antes de desplegar." },
      { status: 400 }
    );
  }

  const files = JSON.parse(code.files) as FileTree;
  const { frontendPort, backendPort } = portsFor(projectId);

  await writeFiles(projectId, files);

  await prisma.deployment.upsert({
    where: { projectId },
    create: {
      projectId,
      status: "building",
      logs: "Construyendo imagenes Docker...\n",
      frontendUrl: `http://localhost:${frontendPort}`,
      backendUrl: `http://localhost:${backendPort}`,
    },
    update: {
      status: "building",
      logs: "Construyendo imagenes Docker...\n",
      frontendUrl: `http://localhost:${frontendPort}`,
      backendUrl: `http://localhost:${backendPort}`,
    },
  });

  // Ejecucion en background: no bloqueamos la respuesta HTTP.
  (async () => {
    let logBuffer = "";
    const result = await composeUp(projectId, (chunk) => {
      logBuffer += chunk;
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
  })().catch(async (e) => {
    await prisma.deployment
      .update({
        where: { projectId },
        data: { status: "failed", logs: String(e) },
      })
      .catch(() => {});
  });

  return NextResponse.json({
    ok: true,
    status: "building",
    frontendUrl: `http://localhost:${frontendPort}`,
    backendUrl: `http://localhost:${backendPort}`,
  });
}
