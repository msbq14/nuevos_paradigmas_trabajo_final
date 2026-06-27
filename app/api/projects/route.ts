import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/projects -> lista de proyectos
export async function GET() {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(projects);
}

// POST /api/projects { name } -> crea proyecto
export async function POST(req: NextRequest) {
  const { name } = await req.json().catch(() => ({}));
  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "Falta 'name'." }, { status: 400 });
  }
  const project = await prisma.project.create({
    data: { name, currentStage: 1 },
  });
  return NextResponse.json(project, { status: 201 });
}
