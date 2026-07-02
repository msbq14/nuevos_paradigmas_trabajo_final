"use client";

import { useRef } from "react";

type UseCaseActor = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  orphan?: boolean;
};

type UseCaseNode = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type UseCaseEdge = {
  from: string;
  to: string;
};

type UseCaseDiagramData = {
  width: number;
  height: number;
  actors: UseCaseActor[];
  useCases: UseCaseNode[];
  edges: UseCaseEdge[];
};

type ClassNode = {
  id: string;
  name: string;
  attributes: string[][];
  x: number;
  y: number;
  width: number;
  height: number;
};

type ClassEdge = {
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

type ClassDiagramData = {
  width: number;
  height: number;
  nodes: ClassNode[];
  edges: ClassEdge[];
  perspectives: string[];
};

type EdgeSide = "left" | "right" | "top" | "bottom";

function formatTimestampForFilename(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-") + "_" + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("-");
}

function sanitizeFilenamePart(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function downloadSvg(svg: SVGSVGElement, title: string, width: number, height: number) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));

  const serialized = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([serialized], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const filename = `${sanitizeFilenamePart(title)}_${formatTimestampForFilename(new Date())}.svg`;

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function DiagramCardHeader({
  title,
  onDownload,
}: {
  title: string;
  onDownload: () => void;
}) {
  return (
    <div className="px-4 py-3 border-b bg-white flex items-center justify-between gap-3">
      <h3 className="font-semibold text-sm text-gray-800">{title}</h3>
      <button
        type="button"
        onClick={onDownload}
        className="shrink-0 rounded-md border border-gray-300 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100"
      >
        Descargar imagen
      </button>
    </div>
  );
}

function wrapText(label: string, maxChars: number) {
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

function centerX(box: { x: number; width: number }) {
  return box.x + box.width / 2;
}

function centerY(box: { y: number; height: number }) {
  return box.y + box.height / 2;
}

function edgeAnchor(
  from: ClassNode,
  to: ClassNode
): {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  route: "horizontal" | "vertical";
} {
  const dx = centerX(to) - centerX(from);
  const dy = centerY(to) - centerY(from);

  if (Math.abs(dx) >= Math.abs(dy)) {
    return {
      startX: dx >= 0 ? from.x + from.width : from.x,
      startY: centerY(from),
      endX: dx >= 0 ? to.x : to.x + to.width,
      endY: centerY(to),
      route: "horizontal",
    };
  }

  return {
    startX: centerX(from),
    startY: dy >= 0 ? from.y + from.height : from.y,
    endX: centerX(to),
    endY: dy >= 0 ? to.y : to.y + to.height,
    route: "vertical",
  };
}

function edgeSideForPoint(node: ClassNode, x: number, y: number): EdgeSide {
  if (x === node.x) return "left";
  if (x === node.x + node.width) return "right";
  if (y === node.y) return "top";
  return "bottom";
}

function distributeOffsets(count: number, span: number, padding: number) {
  if (count <= 1) return [span / 2];
  const usable = Math.max(span - padding * 2, 1);
  const step = usable / (count - 1);
  return Array.from({ length: count }, (_, index) => padding + index * step);
}

function distributeOffsetsAroundCenter(
  keys: string[],
  span: number,
  padding: number,
  centeredKey?: string
) {
  const offsets = new Map<string, number>();
  if (keys.length === 0) return offsets;
  if (keys.length === 1) {
    offsets.set(keys[0], span / 2);
    return offsets;
  }

  const center = span / 2;
  if (!centeredKey || !keys.includes(centeredKey)) {
    const base = distributeOffsets(keys.length, span, padding);
    keys.forEach((key, index) => offsets.set(key, base[index] ?? center));
    return offsets;
  }

  offsets.set(centeredKey, center);
  const others = keys.filter((key) => key !== centeredKey);
  const topKeys: string[] = [];
  const bottomKeys: string[] = [];

  others.forEach((key, index) => {
    if (index % 2 === 0) topKeys.push(key);
    else bottomKeys.push(key);
  });

  const centerGap = Math.max(20, span * 0.12);
  const topStart = padding;
  const topEnd = Math.max(topStart, center - centerGap);
  const bottomStart = Math.min(span - padding, center + centerGap);
  const bottomEnd = span - padding;

  const topStep = topKeys.length > 1 ? (topEnd - topStart) / (topKeys.length - 1) : 0;
  const bottomStep = bottomKeys.length > 1 ? (bottomEnd - bottomStart) / (bottomKeys.length - 1) : 0;

  topKeys.forEach((key, index) => {
    const offset = topKeys.length === 1 ? (topStart + topEnd) / 2 : topStart + topStep * index;
    offsets.set(key, offset);
  });

  bottomKeys.forEach((key, index) => {
    const offset = bottomKeys.length === 1 ? (bottomStart + bottomEnd) / 2 : bottomStart + bottomStep * index;
    offsets.set(key, offset);
  });

  return offsets;
}

function sidePoint(node: ClassNode, side: EdgeSide, offset: number) {
  switch (side) {
    case "left":
      return { x: node.x, y: node.y + offset };
    case "right":
      return { x: node.x + node.width, y: node.y + offset };
    case "top":
      return { x: node.x + offset, y: node.y };
    case "bottom":
      return { x: node.x + offset, y: node.y + node.height };
  }
}

function segmentIntersectsRect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  node: ClassNode,
  margin = 10
) {
  const left = node.x - margin;
  const right = node.x + node.width + margin;
  const top = node.y - margin;
  const bottom = node.y + node.height + margin;

  if (x1 === x2) {
    const x = x1;
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    return x >= left && x <= right && maxY >= top && minY <= bottom;
  }

  if (y1 === y2) {
    const y = y1;
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    return y >= top && y <= bottom && maxX >= left && minX <= right;
  }

  return false;
}

function pathIntersectsNodes(points: Array<{ x: number; y: number }>, obstacles: ClassNode[]) {
  for (let index = 0; index < points.length - 1; index++) {
    const a = points[index];
    const b = points[index + 1];
    for (const node of obstacles) {
      if (segmentIntersectsRect(a.x, a.y, b.x, b.y, node)) {
        return true;
      }
    }
  }
  return false;
}

function pointsToPath(points: Array<{ x: number; y: number }>) {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

function relevantObstaclesForRoute(
  route: "horizontal" | "vertical",
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  obstacles: ClassNode[]
) {
  if (route === "horizontal") {
    const minX = Math.min(startX, endX);
    const maxX = Math.max(startX, endX);
    return obstacles.filter((node) => node.x <= maxX && node.x + node.width >= minX);
  }

  const minY = Math.min(startY, endY);
  const maxY = Math.max(startY, endY);
  return obstacles.filter((node) => node.y <= maxY && node.y + node.height >= minY);
}

function actorFigureCenterY(actor: UseCaseActor) {
  return actor.y + 25;
}

function actorConnectionX(actor: UseCaseActor) {
  return actor.x + actor.width / 2 + 11;
}

export function UseCaseDiagramCard({
  title,
  data,
}: {
  title: string;
  data: UseCaseDiagramData;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const actorsById = new Map(data.actors.map((actor) => [actor.id, actor]));
  const useCasesById = new Map(data.useCases.map((useCase) => [useCase.id, useCase]));

  return (
    <div className="border rounded-lg bg-gray-50 overflow-hidden">
      <DiagramCardHeader
        title={title}
        onDownload={() => {
          if (svgRef.current) downloadSvg(svgRef.current, title, data.width, data.height);
        }}
      />
      <div className="p-4 overflow-x-auto">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${data.width} ${data.height}`}
          className="w-full min-w-[500px]"
          role="img"
          aria-label={title}
        >
          {data.edges.map((edge) => {
            const actor = actorsById.get(edge.from);
            const useCase = useCasesById.get(edge.to);
            if (!actor || !useCase) return null;

            const dashed = actor.orphan;
            return (
              <line
                key={`${edge.from}-${edge.to}`}
                x1={actorConnectionX(actor)}
                y1={actorFigureCenterY(actor)}
                x2={useCase.x}
                y2={centerY(useCase)}
                stroke={dashed ? "#64748b" : "#2563eb"}
                strokeDasharray={dashed ? "6 4" : undefined}
                strokeWidth="2"
              />
            );
          })}

          {data.actors.map((actor) => {
            const labelLines = wrapText(actor.name, 14);
            const labelStartY = actor.y + 59;
            const stroke = actor.orphan ? "#64748b" : "#2563eb";
            const fill = actor.orphan ? "#334155" : "#1e3a8a";
            const headCx = actor.x + actor.width / 2;
            const headCy = actor.y + 11;

            return (
              <g key={actor.id}>
                <circle
                  cx={headCx}
                  cy={headCy}
                  r="7"
                  fill="none"
                  stroke={stroke}
                  strokeWidth="1.6"
                  strokeDasharray={actor.orphan ? "6 4" : undefined}
                />
                <line
                  x1={headCx}
                  y1={headCy + 7}
                  x2={headCx}
                  y2={headCy + 27}
                  stroke={stroke}
                  strokeWidth="1.6"
                  strokeDasharray={actor.orphan ? "6 4" : undefined}
                  strokeLinecap="round"
                />
                <line
                  x1={headCx - 11}
                  y1={headCy + 14}
                  x2={headCx + 11}
                  y2={headCy + 14}
                  stroke={stroke}
                  strokeWidth="1.6"
                  strokeDasharray={actor.orphan ? "6 4" : undefined}
                  strokeLinecap="round"
                />
                <line
                  x1={headCx}
                  y1={headCy + 27}
                  x2={headCx - 10}
                  y2={headCy + 40}
                  stroke={stroke}
                  strokeWidth="1.6"
                  strokeDasharray={actor.orphan ? "6 4" : undefined}
                  strokeLinecap="round"
                />
                <line
                  x1={headCx}
                  y1={headCy + 27}
                  x2={headCx + 10}
                  y2={headCy + 40}
                  stroke={stroke}
                  strokeWidth="1.6"
                  strokeDasharray={actor.orphan ? "6 4" : undefined}
                  strokeLinecap="round"
                />
                <text
                  x={headCx}
                  y={labelStartY}
                  textAnchor="middle"
                  fontSize="10"
                  fontWeight="600"
                  fill={fill}
                >
                  {labelLines.map((line, index) => (
                    <tspan key={`${actor.id}-${index}`} x={headCx} dy={index === 0 ? 0 : 12}>
                      {line}
                    </tspan>
                  ))}
                </text>
              </g>
            );
          })}

          {data.useCases.map((useCase) => {
            const lines = wrapText(useCase.name, 18);
            const lineHeight = 13;
            const startY = centerY(useCase) - ((lines.length - 1) * lineHeight) / 2 + 4;

            return (
              <g key={useCase.id}>
                <ellipse
                  cx={centerX(useCase)}
                  cy={centerY(useCase)}
                  rx={useCase.width / 2}
                  ry={useCase.height / 2}
                  fill="#fff7ed"
                  stroke="#ea580c"
                  strokeWidth="2"
                />
                <text
                  x={centerX(useCase)}
                  y={startY}
                  textAnchor="middle"
                  fontSize="10"
                  fontWeight="600"
                  fill="#9a3412"
                >
                  {lines.map((line, index) => (
                    <tspan key={`${useCase.id}-${index}`} x={centerX(useCase)} dy={index === 0 ? 0 : lineHeight}>
                      {line}
                    </tspan>
                  ))}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

export function ClassDiagramCard({
  title,
  data,
}: {
  title: string;
  data: ClassDiagramData;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const nodesById = new Map(data.nodes.map((node) => [node.id, node]));
  const edgeKey = (edge: ClassEdge) => `${edge.from}-${edge.to}-${edge.label}`;
  const rawLayoutByEdge = new Map<
    string,
    { route: "horizontal" | "vertical"; startSide: EdgeSide; endSide: EdgeSide }
  >();
  const sideGroups = new Map<string, string[]>();

  for (const edge of data.edges) {
    const from = nodesById.get(edge.from);
    const to = nodesById.get(edge.to);
    if (!from || !to) continue;

    const raw = edgeAnchor(from, to);
    const startSide = edgeSideForPoint(from, raw.startX, raw.startY);
    const endSide = edgeSideForPoint(to, raw.endX, raw.endY);
    const key = edgeKey(edge);

    rawLayoutByEdge.set(key, { route: raw.route, startSide, endSide });
    sideGroups.set(`${edge.from}:${startSide}`, [...(sideGroups.get(`${edge.from}:${startSide}`) ?? []), key]);
    sideGroups.set(`${edge.to}:${endSide}`, [...(sideGroups.get(`${edge.to}:${endSide}`) ?? []), key]);
  }

  const anchoredPointsByEdge = new Map<
    string,
    { startX: number; startY: number; endX: number; endY: number; route: "horizontal" | "vertical" }
  >();

  const centeredEdgeByGroup = new Map<string, string>();
  for (const [groupKey, keys] of sideGroups.entries()) {
    const [nodeId] = groupKey.split(":");
    const node = nodesById.get(nodeId);
    if (!node || keys.length <= 1) continue;

    let bestKey = keys[0];
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const key of keys) {
      const edge = data.edges.find((candidate) => edgeKey(candidate) === key);
      if (!edge) continue;
      const otherId = edge.from === nodeId ? edge.to : edge.from;
      const other = nodesById.get(otherId);
      if (!other) continue;
      const distance = Math.abs(centerX(node) - centerX(other)) + Math.abs(centerY(node) - centerY(other));
      if (distance < bestDistance) {
        bestDistance = distance;
        bestKey = key;
      }
    }

    centeredEdgeByGroup.set(groupKey, bestKey);
  }

  for (const edge of data.edges) {
    const from = nodesById.get(edge.from);
    const to = nodesById.get(edge.to);
    const key = edgeKey(edge);
    const raw = rawLayoutByEdge.get(key);
    if (!from || !to || !raw) continue;

    const startGroup = sideGroups.get(`${edge.from}:${raw.startSide}`) ?? [];
    const endGroup = sideGroups.get(`${edge.to}:${raw.endSide}`) ?? [];
    const startSpan = raw.startSide === "left" || raw.startSide === "right" ? from.height : from.width;
    const endSpan = raw.endSide === "left" || raw.endSide === "right" ? to.height : to.width;
    const startPadding = raw.startSide === "left" || raw.startSide === "right" ? 40 : 24;
    const endPadding = raw.endSide === "left" || raw.endSide === "right" ? 40 : 24;
    const startOffsetMap = distributeOffsetsAroundCenter(
      startGroup,
      startSpan,
      startPadding,
      centeredEdgeByGroup.get(`${edge.from}:${raw.startSide}`)
    );
    const endOffsetMap = distributeOffsetsAroundCenter(
      endGroup,
      endSpan,
      endPadding,
      centeredEdgeByGroup.get(`${edge.to}:${raw.endSide}`)
    );
    const start = sidePoint(from, raw.startSide, startOffsetMap.get(key) ?? startSpan / 2);
    const end = sidePoint(to, raw.endSide, endOffsetMap.get(key) ?? endSpan / 2);

    anchoredPointsByEdge.set(key, {
      startX: start.x,
      startY: start.y,
      endX: end.x,
      endY: end.y,
      route: raw.route,
    });
  }

  return (
    <div className="border rounded-lg bg-gray-50 overflow-hidden">
      <DiagramCardHeader
        title={title}
        onDownload={() => {
          if (svgRef.current) downloadSvg(svgRef.current, title, data.width, data.height);
        }}
      />
      <div className="p-4 overflow-x-auto">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${data.width} ${data.height}`}
          className="w-full min-w-[980px]"
          role="img"
          aria-label={title}
        >
          <defs>
            <marker
              id="uml-arrow"
              markerWidth="10"
              markerHeight="10"
              refX="9"
              refY="3"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M0,0 L0,6 L9,3 z" fill="#64748b" />
            </marker>
            <marker
              id="uml-open-arrow"
              markerWidth="12"
              markerHeight="12"
              refX="10"
              refY="6"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M1,1 L10,6 L1,11" fill="none" stroke="#64748b" strokeWidth="1.6" strokeLinecap="round" />
            </marker>
            <marker
              id="uml-triangle-open"
              markerWidth="14"
              markerHeight="14"
              refX="12"
              refY="7"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M1,1 L12,7 L1,13 z" fill="#ffffff" stroke="#64748b" strokeWidth="1.4" />
            </marker>
            <marker
              id="uml-diamond-open"
              markerWidth="16"
              markerHeight="16"
              refX="8"
              refY="8"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M8,1 L15,8 L8,15 L1,8 z" fill="#ffffff" stroke="#64748b" strokeWidth="1.4" />
            </marker>
            <marker
              id="uml-diamond-filled"
              markerWidth="16"
              markerHeight="16"
              refX="8"
              refY="8"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M8,1 L15,8 L8,15 L1,8 z" fill="#64748b" stroke="#64748b" strokeWidth="1.4" />
            </marker>
          </defs>

          {data.edges.map((edge, index) => {
            const from = nodesById.get(edge.from);
            const to = nodesById.get(edge.to);
            const anchored = anchoredPointsByEdge.get(edgeKey(edge));
            if (!from || !to || !anchored) return null;

            const { startX, startY, endX, endY, route } = anchored;
            const laneOffset = ((index % 5) - 2) * 12;
            const elbowX = (startX + endX) / 2 + (route === "horizontal" ? laneOffset : 0);
            const elbowY = (startY + endY) / 2 + (route === "vertical" ? laneOffset : 0);
            const defaultPoints =
              route === "horizontal"
                ? [
                    { x: startX, y: startY },
                    { x: elbowX, y: startY },
                    { x: elbowX, y: endY },
                    { x: endX, y: endY },
                  ]
                : [
                    { x: startX, y: startY },
                    { x: startX, y: elbowY },
                    { x: endX, y: elbowY },
                    { x: endX, y: endY },
                  ];
            const obstacles = data.nodes.filter((node) => node.id !== from.id && node.id !== to.id);
            let points = defaultPoints;

            if (pathIntersectsNodes(defaultPoints, obstacles)) {
              const relevantObstacles = relevantObstaclesForRoute(route, startX, startY, endX, endY, obstacles);
              const allTop = Math.min(...data.nodes.map((node) => node.y));
              const allBottom = Math.max(...data.nodes.map((node) => node.y + node.height));
              const allLeft = Math.min(...data.nodes.map((node) => node.x));
              const allRight = Math.max(...data.nodes.map((node) => node.x + node.width));
              const minLaneY = 24;
              const maxLaneY = data.height - 24;
              const minLaneX = 24;
              const maxLaneX = data.width - 24;
              const topLane = Math.max(
                minLaneY,
                Math.min(
                  from.y,
                  to.y,
                  ...relevantObstacles.map((node) => node.y)
                ) - 36 - index * 6
              );
              const bottomLane = Math.min(
                maxLaneY,
                Math.max(
                  from.y + from.height,
                  to.y + to.height,
                  ...relevantObstacles.map((node) => node.y + node.height)
                ) + 36 + index * 6
              );
              const leftLane = Math.max(
                minLaneX,
                Math.min(
                  from.x,
                  to.x,
                  ...relevantObstacles.map((node) => node.x)
                ) - 36 - index * 6
              );
              const rightLane = Math.min(
                maxLaneX,
                Math.max(
                  from.x + from.width,
                  to.x + to.width,
                  ...relevantObstacles.map((node) => node.x + node.width)
                ) + 36 + index * 6
              );
              const outerTopLane = Math.max(minLaneY, allTop - 60 - index * 8);
              const outerBottomLane = Math.min(maxLaneY, allBottom + 60 + index * 8);
              const outerLeftLane = Math.max(minLaneX, allLeft - 60 - index * 8);
              const outerRightLane = Math.min(maxLaneX, allRight + 60 + index * 8);
              const alternatives =
                route === "horizontal"
                  ? [
                      [
                        { x: startX, y: startY },
                        { x: startX, y: topLane },
                        { x: endX, y: topLane },
                        { x: endX, y: endY },
                      ],
                      [
                        { x: startX, y: startY },
                        { x: startX, y: bottomLane },
                        { x: endX, y: bottomLane },
                        { x: endX, y: endY },
                      ],
                      [
                        { x: startX, y: startY },
                        { x: startX, y: outerTopLane },
                        { x: endX, y: outerTopLane },
                        { x: endX, y: endY },
                      ],
                      [
                        { x: startX, y: startY },
                        { x: startX, y: outerBottomLane },
                        { x: endX, y: outerBottomLane },
                        { x: endX, y: endY },
                      ],
                    ]
                  : [
                      [
                        { x: startX, y: startY },
                        { x: leftLane, y: startY },
                        { x: leftLane, y: endY },
                        { x: endX, y: endY },
                      ],
                      [
                        { x: startX, y: startY },
                        { x: rightLane, y: startY },
                        { x: rightLane, y: endY },
                        { x: endX, y: endY },
                      ],
                      [
                        { x: startX, y: startY },
                        { x: outerLeftLane, y: startY },
                        { x: outerLeftLane, y: endY },
                        { x: endX, y: endY },
                      ],
                      [
                        { x: startX, y: startY },
                        { x: outerRightLane, y: startY },
                        { x: outerRightLane, y: endY },
                        { x: endX, y: endY },
                      ],
                    ];

              const firstClear = alternatives.find((candidate) => !pathIntersectsNodes(candidate, obstacles));
              if (firstClear) points = firstClear;
            }

            const path = pointsToPath(points);
            const labelPoint = points[Math.floor(points.length / 2)];
            const labelX = labelPoint.x;
            const labelY = labelPoint.y - 10;
            const sourceX = route === "horizontal" ? startX + (endX > startX ? 10 : -10) : startX + 10;
            const sourceY = route === "horizontal" ? startY - 8 : startY + (endY > startY ? 14 : -10);
            const targetX = route === "horizontal" ? endX + (endX > startX ? -10 : 10) : endX + 10;
            const targetY = route === "horizontal" ? endY - 8 : endY + (endY > startY ? -10 : 14);
            const markerEnd =
              edge.kind === "association" || edge.kind === "dependency"
                ? "url(#uml-open-arrow)"
                : edge.kind === "inheritance" || edge.kind === "realization"
                  ? "url(#uml-triangle-open)"
                  : undefined;
            const markerStart =
              edge.kind === "aggregation"
                ? "url(#uml-diamond-open)"
                : edge.kind === "composition"
                  ? "url(#uml-diamond-filled)"
                  : undefined;
            const strokeDasharray =
              edge.kind === "dependency" || edge.kind === "realization" ? "7 5" : undefined;
            const showMultiplicity = !["inheritance", "realization", "dependency"].includes(edge.kind);

            return (
              <g key={`${edge.from}-${edge.to}-${edge.label}`}>
                <path
                  d={path}
                  fill="none"
                  stroke="#64748b"
                  strokeWidth="2"
                  strokeDasharray={strokeDasharray}
                  markerStart={markerStart}
                  markerEnd={edge.kind === "bidirectional_association" ? undefined : markerEnd}
                />
                <text
                  x={labelX}
                  y={labelY}
                  textAnchor="middle"
                  fontSize="12"
                  fontWeight="600"
                  fill="#374151"
                  stroke="#f8fafc"
                  strokeWidth="4"
                  paintOrder="stroke"
                  strokeLinejoin="round"
                >
                  {edge.label}
                </text>
                {showMultiplicity && (
                  <>
                    <text
                      x={sourceX}
                      y={sourceY}
                      textAnchor={route === "horizontal" ? (endX > startX ? "start" : "end") : "start"}
                      fontSize="12"
                      fill="#475569"
                    >
                      {edge.sourceMultiplicity}
                    </text>
                    <text
                      x={targetX}
                      y={targetY}
                      textAnchor={route === "horizontal" ? (endX > startX ? "end" : "start") : "start"}
                      fontSize="12"
                      fill="#475569"
                    >
                      {edge.targetMultiplicity}
                    </text>
                  </>
                )}
              </g>
            );
          })}

          {data.nodes.map((node) => (
            <g key={node.id}>
              <rect
                x={node.x}
                y={node.y}
                width={node.width}
                height={node.height}
                rx="12"
                fill="#ffffff"
                stroke="#0f172a"
                strokeWidth="2"
              />
              <rect
                x={node.x}
                y={node.y}
                width={node.width}
                height="30"
                rx="12"
                fill="#e0f2fe"
                stroke="#0ea5e9"
                strokeWidth="0"
              />
              <line
                x1={node.x}
                y1={node.y + 30}
                x2={node.x + node.width}
                y2={node.y + 30}
                stroke="#0f172a"
                strokeWidth="1.5"
              />
              <text
                x={centerX(node)}
                y={node.y + 20}
                textAnchor="middle"
                fontSize="12"
                fontWeight="700"
                fill="#0f172a"
              >
                {node.name}
              </text>
              {(() => {
                let currentY = node.y + 46;
                return node.attributes.map((attributeLines, index) => {
                  const textY = currentY;
                  currentY += attributeLines.length * 14;
                  return (
                    <text
                      key={`${node.id}-${index}`}
                      x={node.x + 10}
                      y={textY}
                      fontSize="10"
                      fill="#334155"
                    >
                      {attributeLines.map((line, lineIndex) => (
                        <tspan key={`${node.id}-${index}-${lineIndex}`} x={node.x + 10} dy={lineIndex === 0 ? 0 : 14}>
                          {line}
                        </tspan>
                      ))}
                    </text>
                  );
                });
              })()}
            </g>
          ))}
        </svg>
      </div>
      <div className="border-t bg-white px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Perspectiva de implementacion de relaciones
        </p>
        <p className="mt-1 text-xs text-gray-500">
          Cada relacion se muestra una sola vez, desde el lado que implementa o declara la referencia principal.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {data.perspectives.map((perspective) => (
            <span
              key={perspective}
              className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs text-sky-800"
            >
              {perspective}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
