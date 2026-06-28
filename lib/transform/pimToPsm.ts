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
  PsmRelationField,
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

function accessor(name: string): string {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

function pluralLower(name: string): string {
  const lower = name.toLowerCase();
  return lower.endsWith("s") ? lower : lower + "s";
}

function toResourcePath(entityName: string): string {
  // Libro -> /libros  (pluralizacion simple)
  return `/${pluralLower(entityName)}`;
}

/**
 * Recorre las relaciones declaradas en el PIM y calcula, para cada entidad
 * involucrada (la que declara la relacion y su target), el campo Prisma
 * correspondiente: quien guarda la foreign key ("reference") y quien expone
 * la coleccion/objeto inverso ("collection" / "single").
 *
 * Convencion de cardinalidad "E:T" (E = quien declara, T = target):
 *   1-N -> E tiene muchos T  => T guarda la FK, E expone el arreglo.
 *   N-1 -> E tiene un T      => E guarda la FK, T expone el arreglo.
 *   1-1 -> E tiene un T (FK en E, unica) => T expone el objeto inverso (sin FK).
 *   N-N -> muchos-a-muchos implicito (Prisma crea la tabla puente solo).
 *
 * Cada relacion debe declararse UNA SOLA VEZ (ver regla en prompts.ts); si el
 * LLM la repite en ambos lados, el guard anti-duplicados de mas abajo evita
 * que el schema Prisma generado quede invalido por nombres de campo repetidos.
 */
const INVERSE_CARDINALITY: Record<string, string> = {
  "1-N": "N-1",
  "N-1": "1-N",
  "1-1": "1-1",
  "N-N": "N-N",
};

function computeRelationFields(pim: PIM): Map<string, PsmRelationField[]> {
  const entityNames = new Set(pim.entities.map((e) => e.name));
  const byEntity = new Map<string, PsmRelationField[]>();
  // Pares entidad<->target (entre entidades distintas) ya cubiertos, para
  // tolerar que el LLM repita la misma relacion desde ambos lados a pesar de
  // la regla del prompt ("declarala UNA SOLA VEZ"). Sin esto, la segunda
  // declaracion genera un campo Prisma sin pareja inversa (schema invalido).
  const seenPairs = new Set<string>();

  const push = (entity: string, field: PsmRelationField) => {
    const list = byEntity.get(entity) ?? [];
    if (list.some((f) => f.name === field.name)) return;
    list.push(field);
    byEntity.set(entity, list);
  };

  for (const entity of pim.entities) {
    for (const rel of entity.relations ?? []) {
      if (!entityNames.has(rel.target)) {
        throw new Error(
          `La relacion "${rel.name}" de "${entity.name}" apunta a una entidad inexistente: "${rel.target}".`
        );
      }

      if (entity.name !== rel.target) {
        const reverseKey = `${rel.target}|${entity.name}|${INVERSE_CARDINALITY[rel.cardinality]}`;
        if (seenPairs.has(reverseKey)) continue;
        seenPairs.add(`${entity.name}|${rel.target}|${rel.cardinality}`);
      }

      const relationName = `${entity.name}_${rel.name}`;
      const inverseName = accessor(entity.name);

      switch (rel.cardinality) {
        case "1-N":
          push(entity.name, { name: rel.name, target: rel.target, kind: "collection", relationName });
          push(rel.target, {
            name: inverseName,
            target: entity.name,
            kind: "reference",
            foreignKey: `${inverseName}Id`,
            relationName,
          });
          break;
        case "N-1":
          push(entity.name, {
            name: rel.name,
            target: rel.target,
            kind: "reference",
            foreignKey: `${accessor(rel.target)}Id`,
            relationName,
          });
          push(rel.target, {
            name: pluralLower(inverseName),
            target: entity.name,
            kind: "collection",
            relationName,
          });
          break;
        case "1-1":
          push(entity.name, {
            name: rel.name,
            target: rel.target,
            kind: "reference",
            foreignKey: `${accessor(rel.target)}Id`,
            unique: true,
            relationName,
          });
          push(rel.target, { name: inverseName, target: entity.name, kind: "single", relationName });
          break;
        case "N-N":
          push(entity.name, { name: rel.name, target: rel.target, kind: "collection", relationName });
          push(rel.target, {
            name: pluralLower(inverseName),
            target: entity.name,
            kind: "collection",
            relationName,
          });
          break;
      }
    }
  }
  return byEntity;
}

function buildPrismaModel(entity: PimEntity, fields: PsmField[], relations: PsmRelationField[]): string {
  const lines: string[] = [];
  lines.push(`model ${entity.name} {`);
  lines.push(`  id Int @id @default(autoincrement())`);
  for (const f of fields) {
    const typeStr = f.prismaType + (f.required ? "" : "?");
    const attrs: string[] = [];
    if (f.unique) attrs.push("@unique");
    lines.push(`  ${f.name} ${typeStr}${attrs.length ? " " + attrs.join(" ") : ""}`);
  }
  for (const r of relations) {
    if (r.kind === "reference") {
      lines.push(`  ${r.foreignKey} Int${r.unique ? " @unique" : ""}`);
      lines.push(
        `  ${r.name} ${r.target} @relation("${r.relationName}", fields: [${r.foreignKey}], references: [id])`
      );
    } else if (r.kind === "collection") {
      lines.push(`  ${r.name} ${r.target}[] @relation("${r.relationName}")`);
    } else {
      lines.push(`  ${r.name} ${r.target}? @relation("${r.relationName}")`);
    }
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
  const relationsByEntity = computeRelationFields(pim);

  const entities: PsmEntity[] = pim.entities.map((entity) => {
    const fields: PsmField[] = entity.attributes.map((attr) => ({
      name: attr.name,
      prismaType: TYPE_MAP[attr.type] || "String",
      required: attr.required ?? false,
      unique: attr.unique ?? false,
    }));
    const relations = relationsByEntity.get(entity.name) ?? [];

    return {
      name: entity.name,
      prismaModel: buildPrismaModel(entity, fields, relations),
      fields,
      relations,
      endpoints: buildCrudEndpoints(entity),
      reactComponents: buildComponents(entity),
    };
  });

  return { entities };
}
