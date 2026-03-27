import type { DiagramExtraction } from "#lib/excalidraw/parser.ts";

export type LineDiff = {
  added: string[];
  removed: string[];
};

export type SemanticDiff = {
  addedComponents: string[];
  removedComponents: string[];
  modifiedComponents: string[];
  addedConnections: string[];
  removedConnections: string[];
};

export function codeDiff(oldCode: string, newCode: string): LineDiff {
  const oldLines = oldCode.split("\n");
  const newLines = newCode.split("\n");
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);

  const added: string[] = [];
  const removed: string[] = [];

  for (const line of newLines) {
    if (!oldSet.has(line)) {
      added.push(line);
    }
  }

  for (const line of oldLines) {
    if (!newSet.has(line)) {
      removed.push(line);
    }
  }

  return { added, removed };
}

function connectionKey(from: string, to: string, label: string | undefined): string {
  if (label !== undefined) {
    return `${from} -> ${to} (${label})`;
  }
  return `${from} -> ${to}`;
}

export function excalidrawSemanticDiff(
  oldExtraction: DiagramExtraction,
  newExtraction: DiagramExtraction,
): SemanticDiff {
  const oldComponentNames = new Set(oldExtraction.components.map((c) => c.name));
  const newComponentNames = new Set(newExtraction.components.map((c) => c.name));

  const addedComponents: string[] = [];
  const removedComponents: string[] = [];
  const modifiedComponents: string[] = [];

  for (const name of newComponentNames) {
    if (!oldComponentNames.has(name)) {
      addedComponents.push(name);
    }
  }

  for (const name of oldComponentNames) {
    if (!newComponentNames.has(name)) {
      removedComponents.push(name);
    }
  }

  // Detect modified components (same name, different type or position)
  const oldComponentMap = new Map(
    oldExtraction.components.map((c) => [c.name, c]),
  );
  for (const comp of newExtraction.components) {
    const old = oldComponentMap.get(comp.name);
    if (old !== undefined && (old.type !== comp.type || old.x !== comp.x || old.y !== comp.y)) {
      modifiedComponents.push(comp.name);
    }
  }

  const oldConnectionKeys = new Set(
    oldExtraction.connections.map((c) => connectionKey(c.from, c.to, c.label)),
  );
  const newConnectionKeys = new Set(
    newExtraction.connections.map((c) => connectionKey(c.from, c.to, c.label)),
  );

  const addedConnections: string[] = [];
  const removedConnections: string[] = [];

  for (const key of newConnectionKeys) {
    if (!oldConnectionKeys.has(key)) {
      addedConnections.push(key);
    }
  }

  for (const key of oldConnectionKeys) {
    if (!newConnectionKeys.has(key)) {
      removedConnections.push(key);
    }
  }

  return {
    addedComponents,
    removedComponents,
    modifiedComponents,
    addedConnections,
    removedConnections,
  };
}
