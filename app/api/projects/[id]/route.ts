import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { composeDown, projectDir } from "@/lib/deploy";

export const dynamic = "force-dynamic";

// GET /api/projects/:id -> estado completo del pipeline
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      messages: { orderBy: { order: "asc" } },
      cim: true,
      pim: true,
      psm: true,
      code: true,
      deployment: true,
      finopsAnalyses: true,
    },
  });
  if (!project) {
    return NextResponse.json({ error: "No existe el proyecto." }, { status: 404 });
  }
  return NextResponse.json(project);
}

// DELETE /api/projects/:id
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const dir = projectDir(id);

  if (existsSync(dir)) {
    const result = await composeDown(id);
    if (result.code !== 0) {
      console.error(
        `docker compose down fallo para el proyecto ${id} (continuando con el borrado):`,
        result.output
      );
    }

    await rm(dir, { recursive: true, force: true }).catch((err) => {
      console.error(`No se pudo borrar generated-apps/${id}:`, err);
    });
  }

  await prisma.project.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
