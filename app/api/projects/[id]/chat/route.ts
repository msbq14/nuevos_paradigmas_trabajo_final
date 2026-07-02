import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { callDeepSeek, type ChatMessage } from "@/lib/deepseek";
import { REQUIREMENTS_ANALYST } from "@/lib/prompts";

export const dynamic = "force-dynamic";

// POST /api/projects/:id/chat { content }
// Guarda el mensaje del usuario, llama a DeepSeek (analista) y guarda la respuesta.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const projectId = params.id;
  const { content } = await req.json().catch(() => ({}));
  if (!content || typeof content !== "string") {
    return NextResponse.json({ error: "Falta 'content'." }, { status: 400 });
  }

  const existing = await prisma.requirementMessage.findMany({
    where: { projectId },
    orderBy: { order: "asc" },
  });
  const nextOrder = existing.length;

  await prisma.requirementMessage.create({
    data: { projectId, role: "user", content, order: nextOrder },
  });

  const history: ChatMessage[] = [
    ...existing.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user", content },
  ];

  let reply: string;
  try {
    const result = await callDeepSeek(history, REQUIREMENTS_ANALYST);
    reply = result.content;
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }

  const assistantMsg = await prisma.requirementMessage.create({
    data: { projectId, role: "assistant", content: reply, order: nextOrder + 1 },
  });

  return NextResponse.json({ reply: assistantMsg.content });
}
