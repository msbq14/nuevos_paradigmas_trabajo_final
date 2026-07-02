import type { PIM } from "./types";

type CimActor = {
  name: string;
  description?: string;
};

type CimUseCase = {
  name: string;
  actor?: string;
  description?: string;
};

type CIM = {
  actors?: CimActor[];
  use_cases?: CimUseCase[];
};

export type UseCaseActor = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  orphan?: boolean;
};

export type UseCaseNode = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type UseCaseEdge = {
  from: string;
  to: string;
};

export type UseCaseDiagramData = {
  width: number;
  height: number;
  actors: UseCaseActor[];
  useCases: UseCaseNode[];
  edges: UseCaseEdge[];
};

export type ClassNode = {
  id: string;
  name: string;
  attributes: string[][];
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ClassEdge = {
  from: string;
  to: string;
  label: string;
  sourceMultiplicity: string;
  targetMultiplicity: string;
  kind:
    | "association"
    | "bidirectional_association"
    | "aggregation"
    | "composition"
    | "dependency"
    | "inheritance"
    | "realization";
};

export type ClassDiagramData = {
  width: number;
  height: number;
  nodes: ClassNode[];
  edges: ClassEdge[];
  perspectives: string[];
};

function safeId(prefix: string, value: string, index: number) {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return `${prefix}_${normalized || "item"}_${index}`;
}

export function parseCim(content: string): CIM | null {
  try {
    return JSON.parse(content) as CIM;
  } catch {
    return null;
  }
}

export function parsePim(content: string): PIM | null {
  try {
    return JSON.parse(content) as PIM;
  } catch {
    return null;
  }
}

export function buildCimUseCaseDiagram(cim: CIM): UseCaseDiagramData {
  const actors = cim.actors ?? [];
  const useCases = cim.use_cases ?? [];
  const useCasesByActor = new Map<string, CimUseCase[]>();

  actors.forEach((actor) => {
    useCasesByActor.set(actor.name, []);
  });

  useCases.forEach((useCase) => {
    if (useCase.actor && useCasesByActor.has(useCase.actor)) {
      useCasesByActor.get(useCase.actor)?.push(useCase);
    }
  });

  const actorBoxWidth = 84;
  const actorBoxHeight = 83;
  const useCaseWidth = 147;
  const useCaseHeight = 53;
  const leftMargin = 28;
  const topMargin = 28;
  const actorX = leftMargin;
  const useCaseStartX = 175;
  const verticalGap = 24;
  const actorBlockGap = 53;
  const staggerOffsets = [0, 25, 11, 34];

  const actorNodes: UseCaseActor[] = [];
  const useCaseNodes: UseCaseNode[] = [];
  const edges: UseCaseEdge[] = [];
  let currentY = topMargin;

  actors.forEach((actor, actorIndex) => {
    const group = useCasesByActor.get(actor.name) ?? [];
    if (group.length === 0) return;

    const stackHeight = group.length * useCaseHeight + Math.max(0, group.length - 1) * verticalGap;
    const actorY = currentY + Math.max(0, (stackHeight - actorBoxHeight) / 2);
    const actorNode: UseCaseActor = {
      id: safeId("actor", actor.name, actorIndex),
      name: actor.name,
      x: actorX,
      y: actorY,
      width: actorBoxWidth,
      height: actorBoxHeight,
    };
    actorNodes.push(actorNode);

    group.forEach((useCase, column) => {
      const offsetX = staggerOffsets[column % staggerOffsets.length];
      const node: UseCaseNode = {
        id: safeId("usecase", useCase.name, actorIndex * 10 + column),
        name: useCase.name,
        x: useCaseStartX + offsetX,
        y: currentY + column * (useCaseHeight + verticalGap),
        width: useCaseWidth,
        height: useCaseHeight,
      };
      useCaseNodes.push(node);
      edges.push({ from: actorNode.id, to: node.id });
    });

    currentY += stackHeight + actorBlockGap;
  });

  const diagramWidth = useCaseNodes.reduce(
    (max, node) => Math.max(max, node.x + node.width + 28),
    useCaseStartX + useCaseWidth + 28
  );
  const diagramHeight = Math.max(currentY - actorBlockGap + topMargin, actorBoxHeight + topMargin * 2);

  return {
    width: diagramWidth,
    height: diagramHeight,
    actors: actorNodes,
    useCases: useCaseNodes,
    edges,
  };
}

function relationMultiplicity(cardinality: string): [string, string] {
  switch (cardinality) {
    case "1-1":
      return ["1", "1"];
    case "1-N":
      return ["1", "*"];
    case "N-1":
      return ["*", "1"];
    case "N-N":
      return ["*", "*"];
    default:
      return ["?", "?"];
  }
}

function cardinalityFamily(cardinality: string) {
  if (cardinality === "1-N" || cardinality === "N-1") return "one-many";
  if (cardinality === "1-1") return "one-one";
  if (cardinality === "N-N") return "many-many";
  return cardinality;
}

function implementationPerspectiveSource(
  entityName: string,
  relation: NonNullable<PIM["entities"][number]["relations"]>[number]
) {
  switch (relation.cardinality) {
    case "1-N":
      return relation.target;
    case "N-1":
    case "1-1":
      return entityName;
    case "N-N":
    default:
      return entityName;
  }
}

function wrapDiagramText(label: string, maxChars: number) {
  const words = label.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [label];

  const lines: string[] = [];
  let current = words[0];

  for (const word of words.slice(1)) {
    if (`${current} ${word}`.length <= maxChars) {
      current += ` ${word}`;
      continue;
    }
    lines.push(current);
    current = word;
  }

  lines.push(current);
  return lines;
}

function formatPimAttribute(attribute: PIM["entities"][number]["attributes"][number]) {
  const suffix = [
    attribute.required ? "required" : "",
    attribute.unique ? "unique" : "",
  ].filter(Boolean);
  return `${attribute.name}: ${attribute.type}${suffix.length ? ` (${suffix.join(", ")})` : ""}`;
}

function entityDegreeMap(pim: PIM) {
  const degrees = new Map<string, number>(pim.entities.map((entity) => [entity.name, 0]));

  for (const entity of pim.entities) {
    for (const relation of entity.relations ?? []) {
      degrees.set(entity.name, (degrees.get(entity.name) ?? 0) + 1);
      degrees.set(relation.target, (degrees.get(relation.target) ?? 0) + 1);
    }
  }

  return degrees;
}

function entityAdjacencyMap(pim: PIM) {
  const adjacency = new Map<string, Set<string>>();
  for (const entity of pim.entities) {
    adjacency.set(entity.name, new Set<string>());
  }

  for (const entity of pim.entities) {
    for (const relation of entity.relations ?? []) {
      adjacency.get(entity.name)?.add(relation.target);
      adjacency.get(relation.target)?.add(entity.name);
    }
  }

  return adjacency;
}

function orderedEntitiesForDiagram(pim: PIM) {
  const degrees = entityDegreeMap(pim);
  const adjacency = entityAdjacencyMap(pim);
  const byName = new Map(pim.entities.map((entity) => [entity.name, entity]));
  const remaining = new Set(pim.entities.map((entity) => entity.name));
  const ordered: PIM["entities"] = [];

  while (remaining.size > 0) {
    const seed = Array.from(remaining).sort((a, b) => {
      const degreeDiff = (degrees.get(b) ?? 0) - (degrees.get(a) ?? 0);
      return degreeDiff !== 0 ? degreeDiff : a.localeCompare(b);
    })[0];

    const queue = [seed];
    remaining.delete(seed);

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;
      const entity = byName.get(current);
      if (entity) ordered.push(entity);

      const neighbors = Array.from(adjacency.get(current) ?? []).filter((name) => remaining.has(name));
      neighbors.sort((a, b) => {
        const degreeDiff = (degrees.get(b) ?? 0) - (degrees.get(a) ?? 0);
        return degreeDiff !== 0 ? degreeDiff : a.localeCompare(b);
      });

      for (const neighbor of neighbors) {
        remaining.delete(neighbor);
        queue.push(neighbor);
      }
    }
  }

  return ordered;
}

export function buildPimClassDiagram(pim: PIM): ClassDiagramData {
  const orderedEntities = orderedEntitiesForDiagram(pim);
  const columns = Math.max(1, Math.min(3, pim.entities.length));
  const cardWidth = 189;
  const routePadding = 84;
  const topMargin = routePadding;
  const leftMargin = routePadding;
  const columnGap = 330;
  const rowGap = 300;
  const nodes: ClassNode[] = [];
  const nameToId = new Map<string, string>();

  orderedEntities.forEach((entity, index) => {
    const row = Math.floor(index / columns);
    const offset = index % columns;
    const column = row % 2 === 0 ? offset : columns - 1 - offset;
    const attributes = [
      ["+id: Integer"],
      ...entity.attributes.map((attribute) => wrapDiagramText(formatPimAttribute(attribute), 34)),
    ];
    const attributeLineCount = attributes.reduce((sum, lines) => sum + lines.length, 0);

    const node: ClassNode = {
      id: safeId("entity", entity.name, index),
      name: entity.name,
      attributes,
      x: leftMargin + column * columnGap,
      y: topMargin + row * rowGap,
      width: cardWidth,
      height: 56 + attributeLineCount * 14,
    };
    nodes.push(node);
    nameToId.set(entity.name, node.id);
  });

  const edgeCandidates: Array<
    ClassEdge & {
      perspective: string;
      implementationSource: string;
      family: string;
      sourceEntity: string;
      targetEntity: string;
      cardinality: string;
    }
  > = [];
  pim.entities.forEach((entity) => {
    const from = nameToId.get(entity.name);
    if (!from) return;

    for (const relation of entity.relations ?? []) {
      const to = nameToId.get(relation.target);
      if (!to) continue;
      const [sourceMultiplicity, targetMultiplicity] = relationMultiplicity(relation.cardinality);
      const implementationSource = implementationPerspectiveSource(entity.name, relation);
      edgeCandidates.push({
        from,
        to,
        label: relation.name,
        sourceMultiplicity,
        targetMultiplicity,
        kind: relation.kind ?? "association",
        perspective: `${implementationSource}.${relation.name} -> ${relation.target}`,
        implementationSource,
        family: cardinalityFamily(relation.cardinality),
        sourceEntity: entity.name,
        targetEntity: relation.target,
        cardinality: relation.cardinality,
      });
    }
  });

  const deduped = new Map<string, (typeof edgeCandidates)[number]>();
  for (const candidate of edgeCandidates) {
    const pair = [candidate.sourceEntity, candidate.targetEntity].sort().join("|");
    const key = `${pair}|${candidate.kind}|${candidate.family}`;
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, candidate);
      continue;
    }

    const candidateMatchesImplementation = candidate.sourceEntity === candidate.implementationSource;
    const existingMatchesImplementation = existing.sourceEntity === existing.implementationSource;

    if (candidateMatchesImplementation && !existingMatchesImplementation) {
      deduped.set(key, candidate);
      continue;
    }

    if (candidateMatchesImplementation === existingMatchesImplementation) {
      const candidatePriority = candidate.sourceEntity.localeCompare(candidate.targetEntity);
      const existingPriority = existing.sourceEntity.localeCompare(existing.targetEntity);
      if (candidatePriority < existingPriority) {
        deduped.set(key, candidate);
      }
    }
  }

  const edges = Array.from(deduped.values()).map(
    ({ perspective: _perspective, implementationSource: _implementationSource, family: _family, sourceEntity: _sourceEntity, targetEntity: _targetEntity, cardinality: _cardinality, ...edge }) => edge
  );
  const perspectives = Array.from(new Set(Array.from(deduped.values()).map((edge) => edge.perspective)));

  const rows = Math.ceil(Math.max(pim.entities.length, 1) / columns);
  const rightPadding = routePadding;
  const bottomPadding = routePadding + 36;
  return {
    width: leftMargin + rightPadding + columns * columnGap - (columnGap - cardWidth),
    height: topMargin + bottomPadding + rows * rowGap + 36,
    nodes,
    edges,
    perspectives,
  };
}
