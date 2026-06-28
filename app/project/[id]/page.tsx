"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Stage = { content: string; status: string } | null;
type CodeStage = { files: string; status: string } | null;
type Message = { id: string; role: string; content: string };
type Deployment = {
  status: string;
  frontendUrl?: string | null;
  backendUrl?: string | null;
  logs?: string;
} | null;

type ProjectState = {
  id: string;
  name: string;
  currentStage: number;
  messages: Message[];
  cim: Stage;
  pim: Stage;
  psm: Stage;
  code: CodeStage;
  deployment: Deployment;
};

const TABS = [
  { key: "chat", label: "1 · Requisitos" },
  { key: "cim", label: "2 · CIM" },
  { key: "pim", label: "3 · PIM" },
  { key: "psm", label: "4 · PSM" },
  { key: "code", label: "5 · Código" },
  { key: "deploy", label: "6 · Docker" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const CHAT_EXAMPLES = [
  "Quiero un sistema de biblioteca para gestionar libros, socios y préstamos.",
  "Necesito una tienda online con catálogo de productos, carrito y pedidos.",
  "Quiero gestionar tareas de un equipo, con proyectos y asignaciones.",
];

function StatusBadge({ status }: { status?: string }) {
  const map: Record<string, string> = {
    approved: "bg-green-100 text-green-800",
    pending: "bg-yellow-100 text-yellow-800",
    rejected: "bg-red-100 text-red-800",
    generating: "bg-blue-100 text-blue-800",
    running: "bg-green-100 text-green-800",
    building: "bg-blue-100 text-blue-800",
    failed: "bg-red-100 text-red-800",
  };
  const s = status || "—";
  return (
    <span className={`text-xs px-2 py-0.5 rounded ${map[s] || "bg-gray-100 text-gray-700"}`}>
      {s}
    </span>
  );
}

export default function ProjectPage({ params }: { params: { id: string } }) {
  const id = params.id;
  const [state, setState] = useState<ProjectState | null>(null);
  const [tab, setTab] = useState<TabKey>("chat");
  const [busy, setBusy] = useState<string>("");
  const [error, setError] = useState<string>("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${id}`);
    if (res.ok) setState(await res.json());
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Polling mientras hay despliegue en curso.
  useEffect(() => {
    if (state?.deployment?.status === "building") {
      const t = setInterval(load, 3000);
      return () => clearInterval(t);
    }
  }, [state?.deployment?.status, load]);

  if (!state) return <p className="text-gray-500">Cargando…</p>;

  async function stageAction(
    name: "cim" | "pim" | "psm" | "code",
    action: string,
    content?: string
  ) {
    setError("");
    setBusy(`${name}:${action}`);
    const res = await fetch(`/api/projects/${id}/stage/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, content }),
    });
    const data = await res.json();
    setBusy("");
    if (!res.ok) setError(data.error || "Error");
    await load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <a href="/" className="text-sm text-blue-600 hover:underline">
            ← Proyectos
          </a>
          <h1 className="text-xl font-bold">{state.name}</h1>
        </div>
        <AutoRunButton id={id} onDone={load} setError={setError} />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded whitespace-pre-wrap">
          {error}
        </div>
      )}

      <div className="flex gap-1 flex-wrap border-b">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-sm rounded-t ${
              tab === t.key ? "bg-white border border-b-white -mb-px font-medium" : "text-gray-500"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "chat" && (
        <ChatPanel
          id={id}
          messages={state.messages}
          cimStatus={state.cim?.status}
          busy={busy}
          onReload={load}
          onFinalize={() => stageAction("cim", "generate").then(() => setTab("cim"))}
        />
      )}

      {tab === "cim" && (
        <ModelPanel
          title="CIM — Requisitos formalizados"
          name="cim"
          content={state.cim?.content}
          status={state.cim?.status}
          busy={busy}
          onAction={stageAction}
        />
      )}
      {tab === "pim" && (
        <ModelPanel
          title="PIM — Modelo de dominio (M2M)"
          name="pim"
          content={state.pim?.content}
          status={state.pim?.status}
          busy={busy}
          onAction={stageAction}
        />
      )}
      {tab === "psm" && (
        <ModelPanel
          title="PSM — Modelo específico Prisma/REST/React (M2M)"
          name="psm"
          content={state.psm?.content}
          status={state.psm?.status}
          busy={busy}
          onAction={stageAction}
        />
      )}
      {tab === "code" && (
        <CodePanel
          files={state.code?.files}
          status={state.code?.status}
          busy={busy}
          onAction={stageAction}
        />
      )}
      {tab === "deploy" && (
        <DeployPanel id={id} deployment={state.deployment} codeStatus={state.code?.status} onReload={load} />
      )}
    </div>
  );
}

// -------------------- Chat (Etapa 1) --------------------
function ChatPanel({
  id,
  messages,
  cimStatus,
  busy,
  onReload,
  onFinalize,
}: {
  id: string;
  messages: Message[];
  cimStatus?: string;
  busy: string;
  onReload: () => void;
  onFinalize: () => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 240) + "px";
  }, [text]);

  async function send() {
    if (!text.trim()) return;
    setSending(true);
    await fetch(`/api/projects/${id}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text }),
    });
    setText("");
    setSending(false);
    onReload();
    textareaRef.current?.focus();
  }

  return (
    <div className="bg-white border rounded-lg p-4 space-y-3">
      <p className="text-sm text-gray-600">
        Describe el sistema que necesitas. DeepSeek actúa como analista de requisitos y hace
        preguntas hasta tener todo claro. Luego pulsa <b>Finalizar y formalizar</b>.
      </p>
      {messages.length === 0 ? (
        <div className="border rounded p-6 bg-gray-50 text-center space-y-3">
          <p className="text-gray-500 text-sm">Empieza describiendo el sistema que necesitas:</p>
          <div className="flex flex-wrap gap-2 justify-center">
            {CHAT_EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => {
                  setText(ex);
                  textareaRef.current?.focus();
                }}
                className="text-xs bg-white border rounded-full px-3 py-1.5 text-gray-600 hover:bg-gray-100"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="h-80 overflow-y-auto border rounded p-3 bg-gray-50 space-y-2">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`text-sm p-2 rounded max-w-[85%] ${
                m.role === "user" ? "bg-blue-100 ml-auto" : "bg-white border"
              }`}
            >
              <pre className="font-sans">{m.content}</pre>
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}
      <div className="flex gap-2 items-end">
        <textarea
          ref={textareaRef}
          className="border rounded px-3 py-2 flex-1 resize-none leading-relaxed max-h-60 overflow-y-auto"
          placeholder="Describe tu sistema… (Enter para enviar, Shift+Enter para nueva línea)"
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          disabled={sending}
        />
        <button
          onClick={send}
          disabled={sending}
          className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50 shrink-0"
        >
          {sending ? "…" : "Enviar"}
        </button>
      </div>
      <p className="text-xs text-gray-400">Enter para enviar · Shift+Enter para salto de línea</p>
      <div className="pt-2 border-t flex items-center justify-between">
        <span className="text-xs text-gray-500">
          CIM: <StatusBadge status={cimStatus} />
        </span>
        <button
          onClick={onFinalize}
          disabled={messages.length === 0 || busy === "cim:generate"}
          className="bg-green-600 text-white px-4 py-2 rounded text-sm disabled:opacity-50"
        >
          {busy === "cim:generate" ? "Formalizando…" : "Finalizar y formalizar →"}
        </button>
      </div>
    </div>
  );
}

// -------------------- Panel genérico de modelo (CIM/PIM/PSM) --------------------
function ModelPanel({
  title,
  name,
  content,
  status,
  busy,
  onAction,
}: {
  title: string;
  name: "cim" | "pim" | "psm";
  content?: string;
  status?: string;
  busy: string;
  onAction: (n: "cim" | "pim" | "psm" | "code", a: string, c?: string) => void;
}) {
  const [draft, setDraft] = useState(content ?? "");
  useEffect(() => {
    setDraft(content ? pretty(content) : "");
  }, [content]);

  const generating = busy === `${name}:generate`;

  return (
    <div className="bg-white border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{title}</h2>
        <StatusBadge status={status} />
      </div>

      {!content && (
        <p className="text-sm text-gray-500">
          Aún no generado. Genera este modelo a partir de la etapa anterior (debe estar aprobada).
        </p>
      )}

      {content && (
        <textarea
          className="w-full h-96 border rounded p-2 font-mono text-xs"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      )}

      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => onAction(name, "generate")}
          disabled={generating}
          className="bg-blue-600 text-white px-3 py-2 rounded text-sm disabled:opacity-50"
        >
          {generating ? "Generando…" : content ? "Regenerar" : "Generar"}
        </button>
        {content && (
          <>
            <button
              onClick={() => onAction(name, "edit", draft)}
              className="bg-gray-200 px-3 py-2 rounded text-sm"
            >
              Guardar edición
            </button>
            <button
              onClick={() => onAction(name, "approve")}
              className="bg-green-600 text-white px-3 py-2 rounded text-sm"
            >
              Aprobar →
            </button>
            <button
              onClick={() => onAction(name, "reject")}
              className="bg-red-600 text-white px-3 py-2 rounded text-sm"
            >
              Rechazar
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// -------------------- Panel de código (Etapa 5) --------------------
function CodePanel({
  files,
  status,
  busy,
  onAction,
}: {
  files?: string;
  status?: string;
  busy: string;
  onAction: (n: "cim" | "pim" | "psm" | "code", a: string, c?: string) => void;
}) {
  const [selected, setSelected] = useState<string>("");
  const tree: Record<string, string> = files ? JSON.parse(files) : {};
  const paths = Object.keys(tree).sort();
  const generating = busy === "code:generate";

  useEffect(() => {
    if (paths.length && !selected) setSelected(paths[0]);
  }, [paths, selected]);

  return (
    <div className="bg-white border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Código generado (M2T) — {paths.length} archivos</h2>
        <StatusBadge status={status} />
      </div>

      {!files && (
        <p className="text-sm text-gray-500">Aún no generado. El PSM debe estar aprobado.</p>
      )}

      {files && (
        <div className="flex gap-3 h-96">
          <div className="w-64 overflow-y-auto border rounded text-xs">
            {paths.map((p) => (
              <button
                key={p}
                onClick={() => setSelected(p)}
                className={`block w-full text-left px-2 py-1 ${
                  selected === p ? "bg-blue-100" : "hover:bg-gray-50"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <pre className="flex-1 overflow-auto border rounded p-2 text-xs bg-gray-50">
            {tree[selected] || ""}
          </pre>
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => onAction("code", "generate")}
          disabled={generating}
          className="bg-blue-600 text-white px-3 py-2 rounded text-sm disabled:opacity-50"
        >
          {generating ? "Generando…" : files ? "Regenerar" : "Generar código"}
        </button>
        {files && (
          <button
            onClick={() => onAction("code", "approve")}
            className="bg-green-600 text-white px-3 py-2 rounded text-sm"
          >
            Aprobar y habilitar despliegue →
          </button>
        )}
      </div>
    </div>
  );
}

// -------------------- Panel de despliegue (Etapa 6) --------------------
function DeployPanel({
  id,
  deployment,
  codeStatus,
  onReload,
}: {
  id: string;
  deployment: Deployment;
  codeStatus?: string;
  onReload: () => void;
}) {
  const [starting, setStarting] = useState(false);

  async function deploy() {
    setStarting(true);
    await fetch(`/api/projects/${id}/deploy`, { method: "POST" });
    setStarting(false);
    onReload();
  }

  const status = deployment?.status || "idle";

  return (
    <div className="bg-white border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Despliegue Docker</h2>
        <StatusBadge status={status} />
      </div>

      {codeStatus !== "approved" && (
        <p className="text-sm text-gray-500">
          Aprueba el código (etapa 5) antes de desplegar.
        </p>
      )}

      <button
        onClick={deploy}
        disabled={codeStatus !== "approved" || starting || status === "building"}
        className="bg-blue-600 text-white px-4 py-2 rounded text-sm disabled:opacity-50"
      >
        {status === "building"
          ? "Construyendo contenedores…"
          : starting
          ? "Iniciando…"
          : "docker compose up -d --build"}
      </button>

      {(status === "running" || status === "building") && deployment && (
        <div className="text-sm space-y-1 pt-2 border-t">
          <p>
            Frontend:{" "}
            <a className="text-blue-600 underline" href={deployment.frontendUrl || "#"} target="_blank">
              {deployment.frontendUrl}
            </a>
          </p>
          <p>
            Backend:{" "}
            <a className="text-blue-600 underline" href={deployment.backendUrl || "#"} target="_blank">
              {deployment.backendUrl}
            </a>
          </p>
          {status === "building" && (
            <p className="text-gray-500 text-xs">
              La primera vez tarda varios minutos (npm install + build dentro de Docker).
            </p>
          )}
        </div>
      )}

      {deployment?.logs && (
        <pre className="text-xs bg-gray-900 text-gray-100 p-3 rounded max-h-72 overflow-auto">
          {deployment.logs}
        </pre>
      )}
    </div>
  );
}

// -------------------- Auto-run --------------------
function AutoRunButton({
  id,
  onDone,
  setError,
}: {
  id: string;
  onDone: () => void;
  setError: (s: string) => void;
}) {
  const [running, setRunning] = useState(false);
  async function run() {
    setError("");
    setRunning(true);
    const res = await fetch(`/api/projects/${id}/autorun`, { method: "POST" });
    const data = await res.json();
    setRunning(false);
    if (!res.ok) setError((data.error || "Error en auto-run") + (data.log ? "\n" + data.log.join("\n") : ""));
    onDone();
  }
  return (
    <button
      onClick={run}
      disabled={running}
      className="bg-purple-600 text-white px-4 py-2 rounded text-sm disabled:opacity-50"
      title="Genera y aprueba CIM→PIM→PSM→Código y despliega, sin intervención"
    >
      {running ? "Auto-run en curso…" : "⚡ Auto-run (todo automático)"}
    </button>
  );
}

function pretty(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}
