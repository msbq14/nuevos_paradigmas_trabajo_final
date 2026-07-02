"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { ClassDiagramCard, UseCaseDiagramCard } from "@/components/UmlDiagrams";
import {
  buildCimUseCaseDiagram,
  buildPimClassDiagram,
  parseCim,
  parsePim,
} from "@/lib/uml";

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

type AICostResult = {
  kind: "ai_cost";
  // Datos brutos de la API
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUSD: number;
  apiCalls: number;
  priceInputPer1M: number;
  priceOutputPer1M: number;
  note?: string;
  // Análisis FinOps generado por DeepSeek
  efficiencyScore: number;
  efficiencyLabel: string;
  costDrivers: Array<{ factor: string; impact: "low" | "medium" | "high"; detail: string }>;
  recommendations: Array<{ priority: "low" | "medium" | "high"; title: string; detail: string }>;
  monthlyProjection: { runsPerMonth: number; costUSD: number };
  insight: string;
};

type FinOpsResult = {
  kind: "full_finops";
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

function parseAICost(analyses: FinOpsAnalysisRecord[], stage: string): AICostResult | null {
  const record = analyses.find((a) => a.stage === stage);
  if (!record) return null;
  try {
    const parsed = JSON.parse(record.content);
    return parsed.kind === "ai_cost" ? (parsed as AICostResult) : null;
  } catch { return null; }
}

function parseFullFinOps(analyses: FinOpsAnalysisRecord[]): FinOpsResult | null {
  const record = analyses.find((a) => a.stage === "deploy");
  if (!record) return null;
  try {
    const parsed = JSON.parse(record.content);
    return parsed.kind === "full_finops" ? (parsed as FinOpsResult) : null;
  } catch { return null; }
}

function fmtTokens(n: number): string {
  return n.toLocaleString("es");
}

function fmtCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.000001) return "<$0.000001";
  if (usd < 0.001)    return `$${usd.toFixed(6)}`;
  if (usd < 0.01)     return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

const STAGE_LABEL: Record<string, string> = { cim: "CIM", pim: "PIM", psm: "PSM", code: "Código" };

type TabVisualState = "done" | "pending" | "untouched";

function getTabVisualState(tab: TabKey, state: ProjectState): TabVisualState {
  switch (tab) {
    case "chat":
      if (state.cim) return "done";
      if (state.messages.length > 0) return "pending";
      return "untouched";
    case "cim":
    case "pim":
    case "psm":
      return getStageVisualState(state[tab]);
    case "code":
      return getStageVisualState(state.code);
    case "deploy":
      if (!state.deployment || state.deployment.status === "idle") return "untouched";
      return state.deployment.status === "running" ? "done" : "pending";
    default:
      return "untouched";
  }
}

function getStageVisualState(stage: Stage | CodeStage): TabVisualState {
  if (!stage) return "untouched";
  return stage.status === "approved" ? "done" : "pending";
}

function getTabClasses(visualState: TabVisualState, isActive: boolean): string {
  const base = "px-3 py-2 text-sm rounded-t border transition-colors";
  const tone =
    visualState === "done"
      ? "bg-green-100 text-green-900 border-green-200"
      : visualState === "pending"
        ? "bg-red-100 text-red-900 border-red-200"
        : "bg-gray-100 text-gray-600 border-gray-200";

  const active = isActive ? " -mb-px border-b-white font-semibold" : " opacity-85 hover:opacity-100";

  return `${base} ${tone}${active}`;
}

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [state, setState] = useState<ProjectState | null>(null);
  const [tab, setTab] = useState<TabKey>("chat");
  const [busy, setBusy] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [finopsDone, setFinopsDone] = useState<string | null>(null);
  const prevBusyRef = useRef<string>("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${id}`);
    if (res.ok) setState(await res.json());
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Detecta cuando la generación de una etapa con IA acaba de terminar.
  useEffect(() => {
    const prev = prevBusyRef.current;
    prevBusyRef.current = busy;
    const AI_STAGES = ["cim", "pim", "psm"];
    const prevStage = prev.split(":")[0];
    if (prev.endsWith(":generate") && busy === "" && AI_STAGES.includes(prevStage)) {
      setFinopsDone(STAGE_LABEL[prevStage] ?? prevStage.toUpperCase());
      const t = setTimeout(() => setFinopsDone(null), 5000);
      return () => clearTimeout(t);
    }
  }, [busy]);

  // Polling mientras hay despliegue en curso o mientras el análisis FinOps del deploy aún no llega.
  // generateFinOps() se ejecuta en background DESPUÉS de que el status pasa a "running",
  // por eso hay que seguir polling hasta que el registro aparezca en finopsAnalyses.
  useEffect(() => {
    const deployRunningNoFinOps =
      state?.deployment?.status === "running" &&
      !state.finopsAnalyses.some((a) => a.stage === "deploy");
    if (state?.deployment?.status === "building" || deployRunningNoFinOps) {
      const t = setInterval(load, 3000);
      return () => clearInterval(t);
    }
  }, [state?.deployment?.status, state?.finopsAnalyses, load]);

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

  const AI_GENERATING = ["cim:generate", "pim:generate", "psm:generate"].includes(busy);
  const approvingStage = busy.endsWith(":approve") ? busy.split(":")[0] : "";
  const diagramGeneratingStage =
    busy === "cim:generate" ? "cim" : busy === "pim:generate" ? "pim" : "";

  return (
    <div className="space-y-4">
      {AI_GENERATING && <FinOpsToast />}
      {diagramGeneratingStage && <DiagramToast mode="generate" stage={diagramGeneratingStage} />}
      {finopsDone && <FinOpsDoneToast stage={finopsDone} />}
      {approvingStage && <ApprovalToast stage={approvingStage} />}
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
        {TABS.map((t) => {
          const visualState = getTabVisualState(t.key, state);
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={getTabClasses(visualState, tab === t.key)}
            >
              {t.label}
            </button>
          );
        })}
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
        <CimPanel
          content={state.cim?.content}
          status={state.cim?.status}
          busy={busy}
          onAction={stageAction}
          aiCost={parseAICost(state.finopsAnalyses, "cim")}
          diagramTitle="Diagrama de casos de uso UML"
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
          aiCost={parseAICost(state.finopsAnalyses, "pim")}
          diagramTitle="Diagrama de clases UML"
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
          aiCost={parseAICost(state.finopsAnalyses, "psm")}
        />
      )}
      {tab === "code" && (
        <CodePanel
          files={state.code?.files}
          status={state.code?.status}
          busy={busy}
          onAction={stageAction}
          aiCost={parseAICost(state.finopsAnalyses, "code")}
        />
      )}
      {tab === "deploy" && (
        <DeployPanel
          id={id}
          deployment={state.deployment}
          codeStatus={state.code?.status}
          onReload={load}
          finops={parseFullFinOps(state.finopsAnalyses)}
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

// -------------------- CIM Panel (vista estructurada) --------------------
type CimData = {
  domain?: string;
  functional_requirements?: Array<{ id: string; description: string }>;
  non_functional_requirements?: Array<{ id: string; description: string; category?: string }>;
  actors?: Array<{ name: string; description?: string }>;
  use_cases?: Array<{ name: string; actor?: string; description?: string }>;
};

function CimPanel({
  content,
  status,
  busy,
  onAction,
  aiCost,
  diagramTitle,
}: {
  content?: string;
  status?: string;
  busy: string;
  onAction: (n: "cim" | "pim" | "psm" | "code", a: string, c?: string) => void;
  aiCost: AICostResult | null;
  diagramTitle?: string;
}) {
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState(content ? pretty(content) : "");
  const [diagramSource, setDiagramSource] = useState(content ?? "");
  const [updatingDiagram, setUpdatingDiagram] = useState(false);
  useEffect(() => { setDraft(content ? pretty(content) : ""); }, [content]);
  useEffect(() => { setDiagramSource(content ?? ""); }, [content]);

  const generating = busy === "cim:generate";
  const canShowDiagram = Boolean(diagramSource && diagramTitle);
  const cimDiagramData =
    diagramSource
      ? (() => {
          const parsed = parseCim(diagramSource);
          return parsed ? buildCimUseCaseDiagram(parsed) : null;
        })()
      : null;

  let cim: CimData | null = null;
  if (content) {
    try { cim = JSON.parse(content) as CimData; } catch { /* render edit mode si JSON inválido */ }
  }

  async function refreshDiagram() {
    setUpdatingDiagram(true);
    await wait(500);
    setDiagramSource(draft);
    setUpdatingDiagram(false);
  }

  return (
    <div className="bg-white border rounded-lg p-4 space-y-4">
      {/* Cabecera */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">CIM — Requisitos formalizados</h2>
          <StatusBadge status={status} />
        </div>
        {cim && !editMode && (
          <button
            onClick={() => setEditMode(true)}
            className="text-xs text-gray-500 border rounded px-2 py-1 hover:bg-gray-50"
          >
            Editar JSON
          </button>
        )}
        {editMode && (
          <button
            onClick={() => setEditMode(false)}
            className="text-xs text-gray-500 border rounded px-2 py-1 hover:bg-gray-50"
          >
            ← Ver estructura
          </button>
        )}
      </div>

      {/* Sin contenido */}
      {!content && (
        <p className="text-sm text-gray-500">
          Aún no generado. Genera el CIM a partir de los requisitos del chat.
        </p>
      )}

      {/* Vista estructurada */}
      {cim && !editMode && (
        <div className="space-y-4">
          {cim.domain && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Dominio</span>
              <span className="text-sm bg-gray-100 text-gray-700 rounded-full px-3 py-0.5">{cim.domain}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Requisitos Funcionales */}
            <div className="border rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2 mb-1">
                <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                  Requisitos Funcionales
                  <span className="ml-1.5 text-blue-600 font-bold">{cim.functional_requirements?.length ?? 0}</span>
                </h3>
              </div>
              {(cim.functional_requirements ?? []).length === 0 && (
                <p className="text-xs text-gray-400 italic">Sin requisitos funcionales</p>
              )}
              <ul className="space-y-1.5">
                {(cim.functional_requirements ?? []).map((fr) => (
                  <li key={fr.id} className="flex items-start gap-2">
                    <span className="shrink-0 text-xs bg-blue-100 text-blue-700 font-mono font-medium px-1.5 py-0.5 rounded mt-0.5">{fr.id}</span>
                    <span className="text-xs text-gray-700 leading-snug">{fr.description}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Requisitos No Funcionales */}
            <div className="border rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2 mb-1">
                <span className="w-2 h-2 rounded-full bg-purple-500 shrink-0" />
                <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                  Requisitos No Funcionales
                  <span className="ml-1.5 text-purple-600 font-bold">{cim.non_functional_requirements?.length ?? 0}</span>
                </h3>
              </div>
              {(cim.non_functional_requirements ?? []).length === 0 && (
                <p className="text-xs text-gray-400 italic">Sin requisitos no funcionales</p>
              )}
              <ul className="space-y-1.5">
                {(cim.non_functional_requirements ?? []).map((nfr) => (
                  <li key={nfr.id} className="flex items-start gap-2">
                    <span className="shrink-0 text-xs bg-purple-100 text-purple-700 font-mono font-medium px-1.5 py-0.5 rounded mt-0.5">{nfr.id}</span>
                    <div className="min-w-0">
                      {nfr.category && (
                        <span className="text-xs text-purple-500 font-medium mr-1">[{nfr.category}]</span>
                      )}
                      <span className="text-xs text-gray-700 leading-snug">{nfr.description}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

          </div>
        </div>
      )}

      {/* Editor JSON */}
      {content && editMode && (
        <textarea
          className="w-full h-96 border rounded p-2 font-mono text-xs"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      )}

      {/* Acciones */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => onAction("cim", "generate")}
          disabled={generating}
          className="bg-blue-600 text-white px-3 py-2 rounded text-sm disabled:opacity-50"
        >
          {generating ? "Generando…" : content ? "Regenerar" : "Generar"}
        </button>
        {content && editMode && (
          <button
            onClick={() => { onAction("cim", "edit", draft); setEditMode(false); }}
            className="bg-gray-200 px-3 py-2 rounded text-sm"
          >
            Guardar edición
          </button>
        )}
        {content && diagramTitle && (
          <button
            onClick={refreshDiagram}
            disabled={updatingDiagram}
            className="bg-amber-100 text-amber-800 px-3 py-2 rounded text-sm disabled:opacity-50"
          >
            {updatingDiagram ? "Actualizando diagrama…" : "Actualizar diagrama"}
          </button>
        )}
        {content && (
          <>
            <button
              onClick={() => onAction("cim", "approve")}
              className="bg-green-600 text-white px-3 py-2 rounded text-sm"
            >
              Aprobar →
            </button>
            <button
              onClick={() => onAction("cim", "reject")}
              className="bg-red-600 text-white px-3 py-2 rounded text-sm"
            >
              Rechazar
            </button>
          </>
        )}
      </div>

      {!canShowDiagram && content && diagramTitle && (
        <p className="text-sm text-gray-500">
          Genera o regenera el modelo para mostrar el {diagramTitle.toLowerCase()}.
        </p>
      )}

      {canShowDiagram && cimDiagramData && (
        <UseCaseDiagramCard title={diagramTitle!} data={cimDiagramData} />
      )}

      {canShowDiagram && !cimDiagramData && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded">
          No se pudo generar el diagrama UML a partir del JSON actual de esta etapa.
        </div>
      )}

      {updatingDiagram && <DiagramInlineFeedback />}
      {aiCost && <AICostPanel aiCost={aiCost} />}
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
  aiCost,
  diagramTitle,
}: {
  title: string;
  name: "cim" | "pim" | "psm";
  content?: string;
  status?: string;
  busy: string;
  onAction: (n: "cim" | "pim" | "psm" | "code", a: string, c?: string) => void;
  aiCost: AICostResult | null;
  diagramTitle?: string;
}) {
  const [draft, setDraft] = useState(content ?? "");
  const [diagramSource, setDiagramSource] = useState(content ?? "");
  const [updatingDiagram, setUpdatingDiagram] = useState(false);
  useEffect(() => {
    setDraft(content ? pretty(content) : "");
  }, [content]);
  useEffect(() => {
    setDiagramSource(content ?? "");
  }, [content]);

  const generating = busy === `${name}:generate`;
  const canShowDiagram = Boolean(diagramSource && diagramTitle && (name === "cim" || name === "pim"));
  const cimDiagramData =
    diagramSource && name === "cim"
      ? (() => {
          const parsed = parseCim(diagramSource);
          return parsed ? buildCimUseCaseDiagram(parsed) : null;
        })()
      : null;
  const pimDiagramData =
    diagramSource && name === "pim"
      ? (() => {
          const parsed = parsePim(diagramSource);
          return parsed ? buildPimClassDiagram(parsed) : null;
        })()
      : null;
  const showDiagramHint = Boolean(!canShowDiagram && content && diagramTitle);

  async function refreshDiagram() {
    setUpdatingDiagram(true);
    await wait(500);
    setDiagramSource(draft);
    setUpdatingDiagram(false);
  }

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
            {diagramTitle && (
              <button
                onClick={refreshDiagram}
                disabled={updatingDiagram}
                className="bg-amber-100 text-amber-800 px-3 py-2 rounded text-sm disabled:opacity-50"
              >
                {updatingDiagram ? "Actualizando diagrama…" : "Actualizar diagrama"}
              </button>
            )}
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

      {showDiagramHint && (
        <p className="text-sm text-gray-500">
          Genera o regenera el modelo para mostrar el {diagramTitle?.toLowerCase()}.
        </p>
      )}

      {canShowDiagram && diagramTitle && name === "cim" && cimDiagramData && (
        <UseCaseDiagramCard title={diagramTitle} data={cimDiagramData} />
      )}

      {canShowDiagram && diagramTitle && name === "pim" && pimDiagramData && (
        <ClassDiagramCard title={diagramTitle} data={pimDiagramData} />
      )}

      {canShowDiagram && diagramTitle && name === "cim" && !cimDiagramData && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded">
          No se pudo generar el diagrama UML a partir del JSON actual de esta etapa.
        </div>
      )}

      {canShowDiagram && diagramTitle && name === "pim" && !pimDiagramData && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded">
          No se pudo generar el diagrama UML a partir del JSON actual de esta etapa.
        </div>
      )}

      {updatingDiagram && <DiagramInlineFeedback />}
      {aiCost && <AICostPanel aiCost={aiCost} />}
    </div>
  );
}

// -------------------- Panel de código (Etapa 5) --------------------
function CodePanel({
  files,
  status,
  busy,
  onAction,
  aiCost,
}: {
  files?: string;
  status?: string;
  busy: string;
  onAction: (n: "cim" | "pim" | "psm" | "code", a: string, c?: string) => void;
  aiCost: AICostResult | null;
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

      {aiCost && <AICostPanel aiCost={aiCost} />}
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

// -------------------- Approval Toast --------------------
function ApprovalToast({ stage }: { stage: string }) {
  const title =
    stage === "cim"
      ? "Aprobando CIM y creando diagrama de casos de uso"
      : stage === "pim"
        ? "Aprobando PIM y actualizando diagrama UML"
        : "Aprobando etapa";
  const message =
    stage === "cim" || stage === "pim"
      ? "Esto puede tardar unos segundos…"
      : "Guardando cambios de la etapa…";

  return (
    <div className="fixed top-4 right-4 z-50 flex items-center gap-3 bg-white border border-gray-200 shadow-lg rounded-lg px-4 py-3 text-sm text-gray-700">
      <svg className="animate-spin w-4 h-4 text-blue-500 shrink-0" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
      </svg>
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-xs text-gray-400">{message}</p>
      </div>
    </div>
  );
}

function DiagramToast({ mode, stage }: { mode: "generate" | "refresh"; stage: string }) {
  const title =
    mode === "generate"
      ? stage === "cim"
        ? "Creando diagrama de casos de uso"
        : "Creando diagrama de clases"
      : stage === "cim"
        ? "Actualizando diagrama de casos de uso"
        : "Actualizando diagrama de clases";
  const message =
    mode === "generate"
      ? "Se renderizará automáticamente al terminar la generación."
      : "Aplicando los cambios del JSON al diagrama.";

  return (
    <div className="fixed top-24 right-4 z-50 flex items-center gap-3 bg-white border border-amber-200 shadow-lg rounded-lg px-4 py-3 text-sm text-gray-700">
      <svg className="animate-spin w-4 h-4 text-amber-500 shrink-0" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
      </svg>
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-xs text-gray-400">{message}</p>
      </div>
    </div>
  );
}

function DiagramInlineFeedback() {
  return (
    <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
      <svg className="animate-spin w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
      </svg>
      <span>Actualizando diagrama, espera un momento…</span>
    </div>
  );
}

// -------------------- AI Cost Panel --------------------
// Análisis FinOps por etapa: costo real de API + análisis generado por DeepSeek
// (eficiencia, factores que impulsaron el costo, recomendaciones, proyección mensual).
// Para la etapa Código (M2T sin IA) muestra un análisis estático con costo $0.
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
const IMPACT_LABEL: Record<string, string> = { low: "Bajo", medium: "Medio", high: "Alto" };
const PRIORITY_LABEL: Record<string, string> = { low: "Baja", medium: "Media", high: "Alta" };

function EfficiencyBar({ score, label }: { score: number; label: string }) {
  const colors = ["", "bg-red-500", "bg-orange-500", "bg-yellow-500", "bg-green-400", "bg-green-600"];
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className={`w-4 h-2 rounded-sm ${i <= score ? (colors[score] ?? "bg-blue-500") : "bg-gray-200"}`}
          />
        ))}
      </div>
      <span className="text-xs font-medium text-gray-600">{label}</span>
    </div>
  );
}

function AICostPanel({ aiCost }: { aiCost: AICostResult }) {
  const noAI = aiCost.apiCalls === 0;

  return (
    <div className="mt-4 border-t pt-4 space-y-4">
      {/* Título */}
      <div className="flex items-center gap-2">
        <span className="text-base select-none">💸</span>
        <h3 className="font-semibold text-sm text-gray-800">Análisis FinOps — costo de IA en esta etapa</h3>
      </div>

      {/* Etapa sin IA */}
      {noAI ? (
        <>
          <div className="flex items-center gap-2 bg-gray-50 border rounded-lg px-3 py-2 text-sm text-gray-600">
            <span className="text-gray-400">⚡</span>
            <span>{aiCost.note ?? "Transformación determinista: sin llamadas a la API de IA."}</span>
            <span className="ml-auto font-bold text-gray-700">$0.00</span>
          </div>
          {aiCost.insight && (
            <p className="text-xs text-gray-500 italic border-l-2 border-gray-200 pl-2">{aiCost.insight}</p>
          )}
        </>
      ) : (
        <>
          {/* Fila 1: tokens + costo + eficiencia */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Tokens */}
            <div className="border rounded-lg p-3 space-y-2">
              <p className="text-xs text-gray-400 uppercase tracking-wide">Tokens utilizados</p>
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Entrada</span>
                  <span className="font-mono text-gray-700">{fmtTokens(aiCost.promptTokens)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Salida</span>
                  <span className="font-mono text-gray-700">{fmtTokens(aiCost.completionTokens)}</span>
                </div>
                <div className="flex justify-between text-xs border-t pt-1 mt-1">
                  <span className="font-medium text-gray-600">Total</span>
                  <span className="font-mono font-semibold text-gray-800">{fmtTokens(aiCost.totalTokens)}</span>
                </div>
              </div>
              {aiCost.apiCalls > 1 && (
                <p className="text-xs text-amber-600 bg-amber-50 rounded px-2 py-0.5">
                  {aiCost.apiCalls} llamadas (reintentos por validación)
                </p>
              )}
            </div>

            {/* Costo */}
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 flex flex-col justify-between">
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Costo de esta ejecución</p>
              <p className="text-2xl font-bold text-blue-700">{fmtCost(aiCost.costUSD)}</p>
              <div className="mt-2 space-y-0.5 text-xs text-gray-400">
                <p>Modelo: <span className="text-gray-600">{aiCost.model}</span></p>
                <p>${aiCost.priceInputPer1M}/1M entrada · ${aiCost.priceOutputPer1M}/1M salida</p>
              </div>
            </div>

            {/* Proyección + eficiencia */}
            <div className="border rounded-lg p-3 space-y-3">
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-1.5">Eficiencia</p>
                <EfficiencyBar score={aiCost.efficiencyScore} label={aiCost.efficiencyLabel} />
              </div>
              {aiCost.monthlyProjection && (
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">
                    Proyección mensual ({aiCost.monthlyProjection.runsPerMonth} ejecuciones)
                  </p>
                  <p className="text-lg font-bold text-gray-700">
                    {fmtCost(aiCost.monthlyProjection.costUSD)}
                    <span className="text-xs font-normal text-gray-400 ml-1">/ mes</span>
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Insight */}
          {aiCost.insight && (
            <p className="text-xs text-gray-600 italic border-l-2 border-blue-300 pl-3 bg-blue-50 py-2 rounded-r">
              {aiCost.insight}
            </p>
          )}

          {/* Factores que impulsaron el costo */}
          {aiCost.costDrivers?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Factores que impulsaron el costo
              </p>
              <div className="space-y-1.5">
                {aiCost.costDrivers.map((d, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${IMPACT_STYLE[d.impact] ?? IMPACT_STYLE.low}`}>
                      {IMPACT_LABEL[d.impact] ?? d.impact}
                    </span>
                    <p className="text-xs text-gray-600">
                      <span className="font-medium text-gray-700">{d.factor}:</span> {d.detail}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recomendaciones */}
          {aiCost.recommendations?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Recomendaciones para reducir el costo
              </p>
              <div className="space-y-2">
                {aiCost.recommendations.map((r, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${PRIORITY_STYLE[r.priority] ?? PRIORITY_STYLE.low}`}>
                      {PRIORITY_LABEL[r.priority] ?? r.priority}
                    </span>
                    <div>
                      <p className="text-xs font-medium text-gray-700">{r.title}</p>
                      <p className="text-xs text-gray-500 leading-snug">{r.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// -------------------- FinOps Toasts --------------------
// FinOpsToast: aparece mientras busy === "*:generate" en etapas con IA (CIM/PIM/PSM).
// FinOpsDoneToast: aparece 5 s cuando la generación termina con éxito.
function FinOpsToast() {
  return (
    <div className="fixed top-4 right-4 z-50 flex items-center gap-3 bg-white border border-gray-200 shadow-lg rounded-lg px-4 py-3 text-sm text-gray-700">
      <svg className="animate-spin w-4 h-4 text-blue-500 shrink-0" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
      </svg>
      <div>
        <p className="font-medium">Calculando costo de IA…</p>
        <p className="text-xs text-gray-400">Generando modelo con DeepSeek</p>
      </div>
    </div>
  );
}

function FinOpsDoneToast({ stage }: { stage: string }) {
  return (
    <div className="fixed top-4 right-4 z-50 flex items-center gap-3 bg-white border border-green-200 shadow-lg rounded-lg px-4 py-3 text-sm text-gray-700">
      <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center shrink-0">
        <svg className="w-3.5 h-3.5 text-green-600" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      </div>
      <div>
        <p className="font-medium text-gray-800">Análisis FinOps de fase <span className="text-blue-600">{stage}</span> completado</p>
        <p className="text-xs text-gray-400">Tokens y costo disponibles en el panel</p>
      </div>
    </div>
  );
}

// -------------------- FinOps Panel --------------------
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
