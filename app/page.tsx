"use client";

import { useEffect, useState } from "react";

type Project = {
  id: string;
  name: string;
  currentStage: number;
  createdAt: string;
};

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    const res = await fetch("/api/projects");
    setProjects(await res.json());
  }
  useEffect(() => {
    load();
  }, []);

  async function create() {
    console.log("hola");
    if (!name.trim()) return;
    setLoading(true);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const p = await res.json();
    setLoading(false);
    if (p.id) window.location.href = `/project/${p.id}`;
  }

  async function remove(id: string) {
    await fetch(`/api/projects/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Tus proyectos</h1>
        <p className="text-gray-600 text-sm mt-1">
          Describe un sistema en lenguaje natural y el pipeline lo lleva hasta
          contenedores Docker corriendo, pasando por CIM, PIM, PSM y generacion
          de codigo.
        </p>
      </div>

      <div className="bg-white border rounded-lg p-4 flex gap-2">
        <input
          className="border rounded px-3 py-2 flex-1"
          placeholder="Nombre del proyecto (ej: Sistema de biblioteca)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
        />
        <button
          onClick={() => create()}
          disabled={loading}
          className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
        >
          {loading ? "Creando..." : "Crear proyecto"}
        </button>
      </div>

      <div className="space-y-2">
        {projects.length === 0 && (
          <p className="text-gray-500 text-sm">Aun no hay proyectos.</p>
        )}
        {projects.map((p) => (
          <div
            key={p.id}
            className="bg-white border rounded-lg p-4 flex items-center justify-between"
          >
            <div>
              <a
                href={`/project/${p.id}`}
                className="font-medium text-blue-700 hover:underline"
              >
                {p.name}
              </a>
              <div className="text-xs text-gray-500">
                Etapa actual: {p.currentStage} / 6
              </div>
            </div>
            <button
              onClick={() => remove(p.id)}
              className="text-red-600 text-sm hover:underline"
            >
              Eliminar
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
