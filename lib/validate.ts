import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { cimSchema, pimSchema, psmSchema } from "./schemas";

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

/** Valida `data` contra el metamodelo indicado. */
export function validateModel(
  kind: "cim" | "pim" | "psm",
  data: unknown
): ValidationResult {
  const validate = validators[kind];
  const valid = validate(data);
  if (valid) return { ok: true };
  const errors = (validate.errors || [])
    .map((e) => `  - ${e.instancePath || "(raiz)"} ${e.message}`)
    .join("\n");
  return { ok: false, errors };
}
