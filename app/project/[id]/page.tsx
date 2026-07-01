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

type FinOpsAnalysisRecord = { stage: string; content: string };

type FinOpsResult = {
  summary: string;
  estimatedMonthlyCost: { min: number; max: number; currency: string; tier: string };
  costDrivers: Array<{ name: string; impact: "low" | "medium" | "high"; description: string }>;
  optimizations: Array<{ priority: "low" | "medium" | "high"; title: string; description: string; estimatedSaving?: string }>;
  complexity: { score: number; label: string; factors: string[] };
  stageInsights: string;
};

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
  finopsAnalyses: FinOpsAnalysisRecord[];
};

function parseFinOps(analyses: FinOpsAnalysisRecord[], stage: string): FinOpsResult | null {
  const record = analyses.find((a) => a.stage === stage);
  if (!record) return null;
  try { return JSON.parse(record.content) as FinOpsResult; } catch { return null; }
}

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

  const finopsRunning = busy.endsWith(":approve");

  return (
    <div className="space-y-4">
      {finopsRunning && <FinOpsToast />}
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
          finops={parseFinOps(state.finopsAnalyses, "cim")}
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
          finops={parseFinOps(state.finopsAnalyses, "pim")}
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
          finops={parseFinOps(state.finopsAnalyses, "psm")}
        />
      )}
      {tab === "code" && (
        <CodePanel
          files={state.code?.files}
          status={state.code?.status}
          busy={busy}
          onAction={stageAction}
          finops={parseFinOps(state.finopsAnalyses, "code")}
        />
      )}
      {tab === "deploy" && (
        <DeployPanel
          id={id}
          deployment={state.deployment}
          codeStatus={state.code?.status}
          onReload={load}
          finops={parseFinOps(state.finopsAnalyses, "deploy")}
        />
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
  finops,
}: {
  title: string;
  name: "cim" | "pim" | "psm";
  content?: string;
  status?: string;
  busy: string;
  onAction: (n: "cim" | "pim" | "psm" | "code", a: string, c?: string) => void;
  finops: FinOpsResult | null;
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

      {finops && <FinOpsPanel finops={finops} />}
    </div>
  );
}

// -------------------- Panel de código (Etapa 5) --------------------
function CodePanel({
  files,
  status,
  busy,
  onAction,
  finops,
}: {
  files?: string;
  status?: string;
  busy: string;
  onAction: (n: "cim" | "pim" | "psm" | "code", a: string, c?: string) => void;
  finops: FinOpsResult | null;
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

      {finops && <FinOpsPanel finops={finops} />}
    </div>
  );
}

// -------------------- Panel de despliegue (Etapa 6) --------------------
function DeployPanel({
  id,
  deployment,
  codeStatus,
  onReload,
  finops,
}: {
  id: string;
  deployment: Deployment;
  codeStatus?: string;
  onReload: () => void;
  finops: FinOpsResult | null;
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

      {status === "running" && !finops && (
        <div className="mt-4 border-t pt-4 flex items-center gap-2 text-sm text-gray-400">
          <svg className="animate-spin w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
          </svg>
          Generando análisis FinOps del despliegue…
        </div>
      )}
      {finops && <FinOpsPanel finops={finops} />}
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

// -------------------- FinOps Toast --------------------
function FinOpsToast() {
  return (
    <div className="fixed top-4 right-4 z-50 flex items-center gap-3 bg-white border border-gray-200 shadow-lg rounded-lg px-4 py-3 text-sm text-gray-700">
      <svg className="animate-spin w-4 h-4 text-blue-500 shrink-0" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
      </svg>
      <div>
        <p className="font-medium">Realizando análisis FinOps</p>
        <p className="text-xs text-gray-400">Esto puede tardar unos segundos…</p>
      </div>
    </div>
  );
}

// -------------------- FinOps Panel --------------------
const IMPACT_STYLE: Record<string, string> = {
  low: "bg-green-100 text-green-700",
  medium: "bg-yellow-100 text-yellow-700",
  high: "bg-red-100 text-red-700",
};
const PRIORITY_STYLE: Record<string, string> = {
  low: "bg-gray-100 text-gray-600",
  medium: "bg-orange-100 text-orange-700",
  high: "bg-red-100 text-red-700",
};

function FinOpsPanel({ finops }: { finops: FinOpsResult }) {
  return (
    <div className="mt-4 border-t pt-4 space-y-4">
      {/* Cabecera */}
      <div className="flex items-center gap-2">
        <span className="text-base select-none">💰</span>
        <h3 className="font-semibold text-sm text-gray-800">Análisis FinOps</h3>
      </div>

      {/* Resumen + Costo */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-gray-400 mb-1 uppercase tracking-wide">Resumen</p>
          <p className="text-sm text-gray-700 leading-snug">{finops.summary}</p>
        </div>
        <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
          <p className="text-xs text-gray-400 mb-1 uppercase tracking-wide">Costo mensual estimado</p>
          <p className="text-2xl font-bold text-blue-700">
            ${finops.estimatedMonthlyCost.min}–${finops.estimatedMonthlyCost.max}
            <span className="text-sm font-normal text-blue-500"> {finops.estimatedMonthlyCost.currency}/mes</span>
          </p>
          <p className="text-xs text-gray-500 mt-0.5">{finops.estimatedMonthlyCost.tier}</p>
        </div>
      </div>

      {/* Complejidad */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs text-gray-500">Complejidad:</span>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className={`w-3.5 h-3.5 rounded-sm ${
                i <= finops.complexity.score ? "bg-blue-500" : "bg-gray-200"
              }`}
            />
          ))}
        </div>
        <span className="text-xs font-semibold text-gray-700">{finops.complexity.label}</span>
        {finops.complexity.factors.length > 0 && (
          <span className="text-xs text-gray-400">{finops.complexity.factors.join(" · ")}</span>
        )}
      </div>

      {/* Impulsores de costo */}
      {finops.costDrivers.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Impulsores de costo
          </p>
          <div className="space-y-1.5">
            {finops.costDrivers.map((d, i) => (
              <div key={i} className="flex items-start gap-2">
                <span
                  className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${
                    IMPACT_STYLE[d.impact] ?? IMPACT_STYLE.low
                  }`}
                >
                  {d.impact}
                </span>
                <p className="text-xs text-gray-600">
                  <span className="font-medium text-gray-700">{d.name}:</span> {d.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recomendaciones */}
      {finops.optimizations.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Recomendaciones de optimización
          </p>
          <div className="space-y-2">
            {finops.optimizations.map((o, i) => (
              <div key={i} className="flex items-start gap-2">
                <span
                  className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${
                    PRIORITY_STYLE[o.priority] ?? PRIORITY_STYLE.low
                  }`}
                >
                  {o.priority}
                </span>
                <div>
                  <p className="text-xs font-medium text-gray-700">
                    {o.title}
                    {o.estimatedSaving && (
                      <span className="ml-1 text-green-600 font-normal">({o.estimatedSaving})</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500">{o.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Insight específico de la etapa */}
      {finops.stageInsights && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-xs text-amber-800 leading-snug">
          {finops.stageInsights}
        </div>
      )}
    </div>
  );
}

function pretty(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}
