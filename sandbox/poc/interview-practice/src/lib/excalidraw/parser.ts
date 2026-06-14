import { z } from "zod/v4";

const ExcalidrawElementSchema = z.object({
  id: z.string(),
  type: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  text: z.string().optional(),
  originalText: z.string().optional(),
  startBinding: z
    .object({
      elementId: z.string(),
    })
    .nullable()
    .optional(),
  endBinding: z
    .object({
      elementId: z.string(),
    })
    .nullable()
    .optional(),
  containerId: z.string().nullable().optional(),
  boundElements: z
    .array(
      z.object({
        id: z.string(),
        type: z.string(),
      }),
    )
    .nullable()
    .optional(),
});

type ExcalidrawElement = z.infer<typeof ExcalidrawElementSchema>;

const ExcalidrawFileSchema = z.object({
  elements: z.array(ExcalidrawElementSchema),
});

export type DiagramComponent = {
  name: string;
  type: string;
  x: number;
  y: number;
};

export type DiagramConnection = {
  from: string;
  to: string;
  label: string | undefined;
};

export type DiagramExtraction = {
  components: DiagramComponent[];
  connections: DiagramConnection[];
};

const SHAPE_TYPES = new Set(["rectangle", "ellipse", "diamond", "image"]);

function buildShapeNames(elements: ExcalidrawElement[]): Map<string, string> {
  const shapeNames = new Map<string, string>();
  for (const el of elements) {
    if (
      el.type === "text" &&
      el.containerId !== undefined &&
      el.containerId !== null
    ) {
      const text = el.text ?? el.originalText ?? "";
      if (text !== "") {
        shapeNames.set(el.containerId, text);
      }
    }
  }
  return shapeNames;
}

function extractComponents(
  elements: ExcalidrawElement[],
  shapeNames: Map<string, string>,
): DiagramComponent[] {
  const components: DiagramComponent[] = [];
  for (const el of elements) {
    // Named shapes (rectangle/ellipse/diamond with text inside)
    if (SHAPE_TYPES.has(el.type)) {
      const name = shapeNames.get(el.id) ?? `unnamed-${el.type}`;
      components.push({ name, type: el.type, x: el.x, y: el.y });
      continue;
    }
    // Standalone text (not inside a container) — treat as a component
    if (
      el.type === "text" &&
      (el.containerId === undefined || el.containerId === null)
    ) {
      const text = el.text ?? el.originalText ?? "";
      if (text.trim() !== "") {
        components.push({ name: text.trim(), type: "text", x: el.x, y: el.y });
      }
    }
  }
  return components;
}

function resolveArrowLabel(
  el: ExcalidrawElement,
  elementById: Map<string, ExcalidrawElement>,
): string | undefined {
  const boundElements = el.boundElements;
  if (boundElements === undefined || boundElements === null) return undefined;

  const textBinding = boundElements.find((b) => b.type === "text");
  if (textBinding === undefined) return undefined;

  const textEl = elementById.get(textBinding.id);
  return textEl?.text ?? textEl?.originalText;
}

function extractConnections(
  elements: ExcalidrawElement[],
  shapeNames: Map<string, string>,
  elementById: Map<string, ExcalidrawElement>,
): DiagramConnection[] {
  const connections: DiagramConnection[] = [];
  for (const el of elements) {
    if (el.type !== "arrow") continue;
    const startId = el.startBinding?.elementId;
    const endId = el.endBinding?.elementId;
    if (startId === undefined || endId === undefined) continue;

    const from = shapeNames.get(startId) ?? startId;
    const to = shapeNames.get(endId) ?? endId;
    const label = resolveArrowLabel(el, elementById);
    connections.push({ from, to, label });
  }
  return connections;
}

export function parseElements(json: string): DiagramExtraction {
  const parsed = ExcalidrawFileSchema.parse(JSON.parse(json));
  const elements = parsed.elements;

  const elementById = new Map<string, ExcalidrawElement>();
  for (const el of elements) {
    elementById.set(el.id, el);
  }

  const shapeNames = buildShapeNames(elements);
  const components = extractComponents(elements, shapeNames);
  const connections = extractConnections(elements, shapeNames, elementById);

  return { components, connections };
}
