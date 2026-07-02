// ============================================================
//  METAMODELOS del pipeline MDD, como JSON Schema.
//  (PDF seccion 2.4 - "Por que necesitamos metamodelos")
//  Sirven para validar la salida del LLM en cada etapa.
// ============================================================

// Tipos permitidos en el PIM (independientes de plataforma).
export const PIM_TYPES = [
  "String",
  "Integer",
  "Float",
  "Boolean",
  "Date",
  "Text",
] as const;

// -------------------- CIM --------------------
export const cimSchema = {
  $id: "cim",
  type: "object",
  required: [
    "functional_requirements",
    "non_functional_requirements",
    "actors",
    "use_cases",
  ],
  additionalProperties: true,
  properties: {
    domain: { type: "string" },
    functional_requirements: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "description"],
        properties: {
          id: { type: "string" },
          description: { type: "string" },
        },
      },
    },
    non_functional_requirements: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "description"],
        properties: {
          id: { type: "string" },
          description: { type: "string" },
        },
      },
    },
    actors: {
      type: "array",
      items: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string" },
          description: { type: "string" },
        },
      },
    },
    use_cases: {
      type: "array",
      items: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string" },
          actor: { type: "string" },
          description: { type: "string" },
        },
      },
    },
  },
} as const;

// -------------------- PIM --------------------
export const pimSchema = {
  $id: "pim",
  type: "object",
  required: ["entities"],
  additionalProperties: true,
  properties: {
    entities: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["name", "attributes"],
        additionalProperties: false,
        properties: {
          name: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_]*$" },
          attributes: {
            type: "array",
            items: {
              type: "object",
              required: ["name", "type"],
              additionalProperties: false,
              properties: {
                name: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_]*$" },
                type: { type: "string", enum: PIM_TYPES as unknown as string[] },
                required: { type: "boolean" },
                unique: { type: "boolean" },
              },
            },
          },
          relations: {
            type: "array",
            items: {
              type: "object",
              required: ["name", "target", "cardinality"],
              additionalProperties: false,
              properties: {
                name: { type: "string" },
                target: { type: "string" },
                cardinality: {
                  type: "string",
                  enum: ["1-1", "1-N", "N-1", "N-N"],
                },
                kind: {
                  type: "string",
                  enum: [
                    "association",
                    "bidirectional_association",
                    "aggregation",
                    "composition",
                    "dependency",
                    "inheritance",
                    "realization",
                  ],
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

// -------------------- PSM --------------------
export const psmSchema = {
  $id: "psm",
  type: "object",
  required: ["entities"],
  additionalProperties: true,
  properties: {
    entities: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["name", "prismaModel", "endpoints", "reactComponents"],
        additionalProperties: true,
        properties: {
          name: { type: "string" },
          prismaModel: { type: "string" },
          fields: {
            type: "array",
            items: {
              type: "object",
              required: ["name", "prismaType"],
              properties: {
                name: { type: "string" },
                prismaType: { type: "string" },
                required: { type: "boolean" },
                unique: { type: "boolean" },
              },
            },
          },
          endpoints: {
            type: "array",
            items: {
              type: "object",
              required: ["method", "path"],
              properties: {
                method: { type: "string" },
                path: { type: "string" },
                response: { type: "string" },
                body: { type: "string" },
              },
            },
          },
          reactComponents: {
            type: "array",
            items: {
              type: "object",
              required: ["name", "type"],
              properties: {
                name: { type: "string" },
                type: { type: "string", enum: ["list", "form", "detail"] },
                fields: { type: "array", items: { type: "string" } },
              },
            },
          },
        },
      },
    },
  },
} as const;
