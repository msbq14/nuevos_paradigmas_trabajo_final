// ============================================================
//  Etapa 6: Despliegue Docker.
//  Escribe el FileTree generado a disco y ejecuta docker compose.
// ============================================================

import { spawn } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import type { FileTree } from "./types";

const ROOT = process.cwd();
export const GENERATED_ROOT = path.join(ROOT, "generated-apps");

/** Puerto base configurable. Frontend = base, Backend = base+1, por proyecto. */
function hashToOffset(projectId: string): number {
  let h = 0;
  for (let i = 0; i < projectId.length; i++) {
    h = (h * 31 + projectId.charCodeAt(i)) >>> 0;
  }
  return (h % 400) * 2; // pares: 0,2,4,... para no colisionar front/back
}

export function portsFor(projectId: string): { frontendPort: number; backendPort: number } {
  const base = parseInt(process.env.GENERATED_BASE_PORT || "8080", 10);
  const offset = hashToOffset(projectId);
  const frontendPort = base + offset;
  const backendPort = base + offset + 1;
  return { frontendPort, backendPort };
}

export function projectDir(projectId: string): string {
  return path.join(GENERATED_ROOT, projectId);
}

export function composeProjectName(projectId: string): string {
  return "mdd_" + projectId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24);
}

/** Escribe todo el arbol de archivos a generated-apps/<projectId>/ */
export async function writeFiles(projectId: string, files: FileTree): Promise<string> {
  const dir = projectDir(projectId);
  await rm(dir, { recursive: true, force: true }).catch(() => {});
  await mkdir(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content, "utf8");
  }
  return dir;
}

export interface RunResult {
  code: number;
  output: string;
}

/** Ejecuta un comando y captura stdout+stderr. */
export function run(
  cmd: string,
  args: string[],
  cwd: string,
  onChunk?: (s: string) => void
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, shell: true });
    let output = "";
    const push = (b: Buffer) => {
      const s = b.toString();
      output += s;
      if (onChunk) onChunk(s);
    };
    child.stdout.on("data", push);
    child.stderr.on("data", push);
    child.on("close", (code) => resolve({ code: code ?? -1, output }));
    child.on("error", (err) => resolve({ code: -1, output: output + "\n" + String(err) }));
  });
}

/** docker compose up -d --build en el directorio del proyecto. */
export async function composeUp(
  projectId: string,
  onChunk?: (s: string) => void
): Promise<RunResult> {
  const dir = projectDir(projectId);
  const name = composeProjectName(projectId);
  return run(
    "docker",
    ["compose", "-p", name, "up", "-d", "--build"],
    dir,
    onChunk
  );
}

/** docker compose down -v --remove-orphans (para limpiar / re-desplegar / borrar). */
export async function composeDown(projectId: string): Promise<RunResult> {
  const dir = projectDir(projectId);
  const name = composeProjectName(projectId);
  return run("docker", ["compose", "-p", name, "down", "-v", "--remove-orphans"], dir);
}

/** Estado de los contenedores (para el polling de la UI). */
export async function composeStatus(projectId: string): Promise<RunResult> {
  const dir = projectDir(projectId);
  const name = composeProjectName(projectId);
  return run("docker", ["compose", "-p", name, "ps", "--format", "json"], dir);
}
