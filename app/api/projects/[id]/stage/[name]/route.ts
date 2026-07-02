import { NextRequest, NextResponse } from "next/server";
import {
  approveStage,
  generateStage,
  isStageName,
  rejectStage,
  updateStageContent,
} from "@/lib/stageOps";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/projects/:id/stage/:name  { action: generate|approve|reject|edit, content? }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; name: string }> }
) {
  const { id, name } = await params;
  if (!isStageName(name)) {
    return NextResponse.json({ error: "Etapa invalida." }, { status: 400 });
  }
  const body = await req.json().catch(() => ({}));
  const action = body.action as string;

  try {
    switch (action) {
      case "generate": {
        const result = await generateStage(name, id);
        return NextResponse.json({ ok: true, result });
      }
      case "approve": {
        await approveStage(name, id);
        return NextResponse.json({ ok: true });
      }
      case "reject": {
        await rejectStage(name, id);
        return NextResponse.json({ ok: true });
      }
      case "edit": {
        if (typeof body.content !== "string") {
          return NextResponse.json({ error: "Falta 'content'." }, { status: 400 });
        }
        const result = await updateStageContent(name, id, body.content);
        if (!result.ok) {
          return NextResponse.json({ error: result.errors }, { status: 400 });
        }
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: "Accion invalida." }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
