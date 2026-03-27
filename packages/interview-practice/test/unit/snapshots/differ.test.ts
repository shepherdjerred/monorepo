import { describe, test, expect } from "bun:test";
import { codeDiff, excalidrawSemanticDiff } from "#lib/snapshots/differ.ts";
import type { DiagramExtraction } from "#lib/excalidraw/parser.ts";

describe("codeDiff", () => {
  test("detects added lines", () => {
    const old = "line1\nline2";
    const result = codeDiff(old, "line1\nline2\nline3");
    expect(result.added).toEqual(["line3"]);
    expect(result.removed).toHaveLength(0);
  });

  test("detects removed lines", () => {
    const old = "line1\nline2\nline3";
    const result = codeDiff(old, "line1\nline3");
    expect(result.removed).toEqual(["line2"]);
    expect(result.added).toHaveLength(0);
  });

  test("detects both added and removed lines", () => {
    const old = "function foo() {\n  return 1;\n}";
    const result = codeDiff(old, "function foo() {\n  return 2;\n}");
    expect(result.added).toEqual(["  return 2;"]);
    expect(result.removed).toEqual(["  return 1;"]);
  });

  test("handles identical code", () => {
    const code = "const x = 1;\nconst y = 2;";
    const result = codeDiff(code, code);
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
  });

  test("handles empty strings", () => {
    const result = codeDiff("", "");
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
  });

  test("handles new code from empty", () => {
    const result = codeDiff("", "line1\nline2");
    expect(result.added).toEqual(["line1", "line2"]);
    expect(result.removed).toEqual([""]);
  });
});

describe("excalidrawSemanticDiff", () => {
  const emptyDiagram: DiagramExtraction = {
    components: [],
    connections: [],
  };

  test("detects added components", () => {
    const newDiagram: DiagramExtraction = {
      components: [
        { name: "API Server", type: "rectangle", x: 0, y: 0 },
        { name: "Database", type: "rectangle", x: 200, y: 0 },
      ],
      connections: [],
    };

    const result = excalidrawSemanticDiff(emptyDiagram, newDiagram);
    expect(result.addedComponents.toSorted()).toEqual(["API Server", "Database"]);
    expect(result.removedComponents).toHaveLength(0);
  });

  test("detects removed components", () => {
    const oldDiagram: DiagramExtraction = {
      components: [
        { name: "API Server", type: "rectangle", x: 0, y: 0 },
        { name: "Cache", type: "diamond", x: 100, y: 100 },
      ],
      connections: [],
    };

    const result = excalidrawSemanticDiff(oldDiagram, emptyDiagram);
    expect(result.removedComponents.toSorted()).toEqual(["API Server", "Cache"]);
    expect(result.addedComponents).toHaveLength(0);
  });

  test("detects modified components (position change)", () => {
    const oldDiagram: DiagramExtraction = {
      components: [
        { name: "Server", type: "rectangle", x: 0, y: 0 },
      ],
      connections: [],
    };

    const newDiagram: DiagramExtraction = {
      components: [
        { name: "Server", type: "rectangle", x: 100, y: 200 },
      ],
      connections: [],
    };

    const result = excalidrawSemanticDiff(oldDiagram, newDiagram);
    expect(result.modifiedComponents).toEqual(["Server"]);
    expect(result.addedComponents).toHaveLength(0);
    expect(result.removedComponents).toHaveLength(0);
  });

  test("detects added connections", () => {
    const oldDiagram: DiagramExtraction = {
      components: [
        { name: "A", type: "rectangle", x: 0, y: 0 },
        { name: "B", type: "rectangle", x: 200, y: 0 },
      ],
      connections: [],
    };

    const newDiagram: DiagramExtraction = {
      components: [
        { name: "A", type: "rectangle", x: 0, y: 0 },
        { name: "B", type: "rectangle", x: 200, y: 0 },
      ],
      connections: [{ from: "A", to: "B", label: "HTTP" }],
    };

    const result = excalidrawSemanticDiff(oldDiagram, newDiagram);
    expect(result.addedConnections).toEqual(["A -> B (HTTP)"]);
    expect(result.removedConnections).toHaveLength(0);
  });

  test("detects removed connections", () => {
    const oldDiagram: DiagramExtraction = {
      components: [],
      connections: [{ from: "X", to: "Y", label: undefined }],
    };

    const newDiagram: DiagramExtraction = {
      components: [],
      connections: [],
    };

    const result = excalidrawSemanticDiff(oldDiagram, newDiagram);
    expect(result.removedConnections).toEqual(["X -> Y"]);
  });

  test("handles no changes", () => {
    const diagram: DiagramExtraction = {
      components: [
        { name: "Server", type: "rectangle", x: 10, y: 20 },
      ],
      connections: [{ from: "Server", to: "DB", label: "SQL" }],
    };

    const result = excalidrawSemanticDiff(diagram, diagram);
    expect(result.addedComponents).toHaveLength(0);
    expect(result.removedComponents).toHaveLength(0);
    expect(result.modifiedComponents).toHaveLength(0);
    expect(result.addedConnections).toHaveLength(0);
    expect(result.removedConnections).toHaveLength(0);
  });
});
