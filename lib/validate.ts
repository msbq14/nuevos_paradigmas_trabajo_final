import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { cimSchema, pimSchema, psmSchema } from "./schemas";
import type { PIM } from "./types";

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const validators: Record<string, ValidateFunction> = {
  cim: ajv.compile(cimSchema),
  pim: ajv.compile(pimSchema),
  psm: ajv.compile(psmSchema),
};

export type ValidationResult =
  | { ok: true }
  | { ok: false; errors: string };

function validatePimSemantics(data: unknown): ValidationResult {
  const pim = data as PIM;
  const entities = pim.entities ?? [];
  const entityNames = new Set(entities.map((entity) => entity.name));
  const relationDegree = new Map<string, number>(entities.map((entity) => [entity.name, 0]));

  for (const entity of entities) {
    for (const relation of entity.relations ?? []) {
      if (!entityNames.has(relation.target)) continue;
      relationDegree.set(entity.name, (relationDegree.get(entity.name) ?? 0) + 1);
      relationDegree.set(relation.target, (relationDegree.get(relation.target) ?? 0) + 1);
    }
  }

  const isolated = entities
    .filter((entity) => (relationDegree.get(entity.name) ?? 0) === 0)
    .map((entity) => entity.name);

  if (isolated.length === 0) return { ok: true };

  return {
    ok: false,
    errors:
      "  - Regla de dominio del PIM incumplida: ninguna entidad puede quedar sin relaciones.\n" +
      `  - Entidades aisladas: ${isolated.join(", ")}`,
  };
}

/** Valida `data` contra el metamodelo indicado. */
export function validateModel(
  kind: "cim" | "pim" | "psm",
  data: unknown
): ValidationResult {
  const validate = validators[kind];
  const valid = validate(data);
  if (valid) {
    if (kind === "pim") {
      return validatePimSemantics(data);
    }
    return { ok: true };
  }
  const errors = (validate.errors || [])
    .map((e) => `  - ${e.instancePath || "(raiz)"} ${e.message}`)
    .join("\n");
  return { ok: false, errors };
}
