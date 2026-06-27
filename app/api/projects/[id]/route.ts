import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/projects/:id -> estado completo del pipeline
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const project = await prisma.project.findUnique({
    where: { id: params.id },
    include: {
      messages: { orderBy: { order: "asc" } },
      cim: true,
      pim: true,
      psm: true,
      code: true,
      deployment: true,
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
  { params }: { params: { id: string } }
) {
  await prisma.project.delete({ where: { id: params.id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
