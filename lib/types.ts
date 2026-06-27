// Tipos de los artefactos del pipeline (modelos formales).

export type PimType =
  | "String"
  | "Integer"
  | "Float"
  | "Boolean"
  | "Date"
  | "Text";

export interface PimAttribute {
  name: string;
  type: PimType;
  required?: boolean;
  unique?: boolean;
}

export interface PimRelation {
  name: string;
  target: string;
  cardinality: "1-1" | "1-N" | "N-1" | "N-N";
}

export interface PimEntity {
  name: string;
  attributes: PimAttribute[];
  relations?: PimRelation[];
}

export interface PIM {
  entities: PimEntity[];
}

export interface PsmField {
  name: string;
  prismaType: string; // Int, String, Float, Boolean, DateTime
  required: boolean;
  unique: boolean;
}

export interface PsmEndpoint {
  method: string;
  path: string;
  response?: string;
  body?: string;
  description?: string;
}

export interface PsmComponent {
  name: string;
  type: "list" | "form" | "detail";
  fields: string[];
}

export interface PsmEntity {
  name: string;
  prismaModel: string;
  fields: PsmField[];
  endpoints: PsmEndpoint[];
  reactComponents: PsmComponent[];
}

export interface PSM {
  entities: PsmEntity[];
}

export type FileTree = Record<string, string>; // path -> contenido
