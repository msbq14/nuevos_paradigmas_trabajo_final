// ============================================================
//  Transformacion M2M: PIM -> PSM (PDF etapa 4)
//  Parte PROGRAMATICA y DETERMINISTA (reglas fijas de mapeo).
//  Esto es MDD real: la transformacion es declarativa, no "le pedimos a la IA".
// ============================================================

import type {
  PIM,
  PimEntity,
  PimType,
  PSM,
  PsmEntity,
  PsmField,
  PsmEndpoint,
  PsmComponent,
} from "../types";

// Regla de mapeo de tipos PIM -> Prisma (PDF seccion 3.4).
const TYPE_MAP: Record<PimType, string> = {
  String: "String",
  Text: "String",
  Integer: "Int",
  Float: "Float",
  Boolean: "Boolean",
  Date: "DateTime",
};

function toResourcePath(entityName: string): string {
  // Libro -> /libros  (pluralizacion simple)
  const lower = entityName.toLowerCase();
  const plural = lower.endsWith("s") ? lower : lower + "s";
  return `/${plural}`;
}

function buildPrismaModel(entity: PimEntity, fields: PsmField[]): string {
  const lines: string[] = [];
  lines.push(`model ${entity.name} {`);
  lines.push(`  id Int @id @default(autoincrement())`);
  for (const f of fields) {
    const mods: string[] = [];
    if (!f.required) mods.push("?"); // tipo opcional
    let typeStr = f.prismaType + (f.required ? "" : "?");
    const attrs: string[] = [];
    if (f.unique) attrs.push("@unique");
    lines.push(`  ${f.name} ${typeStr}${attrs.length ? " " + attrs.join(" ") : ""}`);
  }
  lines.push(`  createdAt DateTime @default(now())`);
  lines.push(`}`);
  return lines.join("\n");
}

function buildCrudEndpoints(entity: PimEntity): PsmEndpoint[] {
  const base = toResourcePath(entity.name);
  const name = entity.name;
  return [
    { method: "GET", path: base, response: `${name}[]` },
    { method: "POST", path: base, body: `Create${name}Dto`, response: name },
    { method: "GET", path: `${base}/:id`, response: name },
    { method: "PUT", path: `${base}/:id`, body: `Update${name}Dto`, response: name },
    { method: "DELETE", path: `${base}/:id`, response: "void" },
  ];
}

function buildComponents(entity: PimEntity): PsmComponent[] {
  const fieldNames = entity.attributes.map((a) => a.name);
  const listFields = fieldNames.slice(0, 4); // mostrar primeros campos en la lista
  return [
    { name: `${entity.name}List`, type: "list", fields: listFields },
    { name: `${entity.name}Form`, type: "form", fields: fieldNames },
    { name: `${entity.name}Detail`, type: "detail", fields: fieldNames },
  ];
}

/** Transformacion principal PIM -> PSM (determinista). */
export function pimToPsm(pim: PIM): PSM {
  const entities: PsmEntity[] = pim.entities.map((entity) => {
    const fields: PsmField[] = entity.attributes.map((attr) => ({
      name: attr.name,
      prismaType: TYPE_MAP[attr.type] || "String",
      required: attr.required ?? false,
      unique: attr.unique ?? false,
    }));

    return {
      name: entity.name,
      prismaModel: buildPrismaModel(entity, fields),
      fields,
      endpoints: buildCrudEndpoints(entity),
      reactComponents: buildComponents(entity),
    };
  });

  return { entities };
}
