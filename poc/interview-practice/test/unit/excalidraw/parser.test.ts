import { describe, test, expect } from "bun:test";
import path from "node:path";
import { parseElements } from "#lib/excalidraw/parser.ts";

const FIXTURES_DIR = path.join(import.meta.dirname, "../../fixtures/excalidraw");

describe("excalidraw parser", () => {
  test("parses simple diagram with two components and one connection", async () => {
    const content = await Bun.file(
      path.join(FIXTURES_DIR, "simple-diagram.excalidraw"),
    ).text();
    const result = parseElements(content);

    expect(result.components).toHaveLength(2);
    expect(result.components.map((c) => c.name).toSorted()).toEqual([
      "API Gateway",
      "Database",
    ]);

    expect(result.connections).toHaveLength(1);
    const conn = result.connections[0];
    expect(conn).toBeDefined();
    expect(conn!.from).toBe("API Gateway");
    expect(conn!.to).toBe("Database");
    expect(conn!.label).toBe("queries");
  });

  test("parses complex diagram with multiple shapes and connections", async () => {
    const content = await Bun.file(
      path.join(FIXTURES_DIR, "complex-diagram.excalidraw"),
    ).text();
    const result = parseElements(content);

    expect(result.components).toHaveLength(5);
    const names = result.components.map((c) => c.name).toSorted();
    expect(names).toEqual([
      "API Server",
      "Client",
      "Load Balancer",
      "PostgreSQL",
      "Redis Cache",
    ]);

    // Check that shape types are preserved
    const lb = result.components.find((c) => c.name === "Load Balancer");
    expect(lb).toBeDefined();
    expect(lb!.type).toBe("ellipse");

    const cache = result.components.find((c) => c.name === "Redis Cache");
    expect(cache).toBeDefined();
    expect(cache!.type).toBe("diamond");

    expect(result.connections).toHaveLength(4);

    // Check labeled connections
    const httpConn = result.connections.find((c) => c.label === "HTTP");
    expect(httpConn).toBeDefined();
    expect(httpConn!.from).toBe("Load Balancer");
    expect(httpConn!.to).toBe("API Server");

    const sqlConn = result.connections.find((c) => c.label === "SQL");
    expect(sqlConn).toBeDefined();
    expect(sqlConn!.from).toBe("API Server");
    expect(sqlConn!.to).toBe("PostgreSQL");
  });

  test("parses empty diagram", async () => {
    const content = await Bun.file(
      path.join(FIXTURES_DIR, "empty-diagram.excalidraw"),
    ).text();
    const result = parseElements(content);

    expect(result.components).toHaveLength(0);
    expect(result.connections).toHaveLength(0);
  });

  test("includes unlabeled shapes with fallback name", () => {
    const json = JSON.stringify({
      elements: [
        {
          id: "unlabeled",
          type: "rectangle",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
        },
      ],
    });
    const result = parseElements(json);
    expect(result.components).toHaveLength(1);
    expect(result.components[0]!.name).toBe("unnamed-rectangle");
  });

  test("extracts standalone text as components", () => {
    const json = JSON.stringify({
      elements: [
        {
          id: "txt1",
          type: "text",
          x: 50,
          y: 50,
          width: 80,
          height: 20,
          text: "Cache Layer",
        },
      ],
    });
    const result = parseElements(json);
    expect(result.components).toHaveLength(1);
    expect(result.components[0]!.name).toBe("Cache Layer");
    expect(result.components[0]!.type).toBe("text");
  });

  test("ignores arrows without bindings", () => {
    const json = JSON.stringify({
      elements: [
        {
          id: "free-arrow",
          type: "arrow",
          x: 0,
          y: 0,
          width: 100,
          height: 0,
        },
      ],
    });
    const result = parseElements(json);
    expect(result.connections).toHaveLength(0);
  });

  test("handles arrows with only start binding", () => {
    const json = JSON.stringify({
      elements: [
        {
          id: "rect1",
          type: "rectangle",
          x: 0,
          y: 0,
          width: 100,
          height: 50,
          boundElements: [{ id: "t1", type: "text" }],
        },
        {
          id: "t1",
          type: "text",
          x: 10,
          y: 10,
          width: 80,
          height: 30,
          text: "Box",
          containerId: "rect1",
        },
        {
          id: "arrow-partial",
          type: "arrow",
          x: 100,
          y: 25,
          width: 50,
          height: 0,
          startBinding: { elementId: "rect1" },
          endBinding: null,
        },
      ],
    });
    const result = parseElements(json);
    expect(result.connections).toHaveLength(0);
  });

  test("preserves component coordinates", () => {
    const json = JSON.stringify({
      elements: [
        {
          id: "r1",
          type: "rectangle",
          x: 42,
          y: 99,
          width: 100,
          height: 50,
          boundElements: [{ id: "t1", type: "text" }],
        },
        {
          id: "t1",
          type: "text",
          x: 50,
          y: 110,
          width: 80,
          height: 30,
          text: "Server",
          containerId: "r1",
        },
      ],
    });
    const result = parseElements(json);
    expect(result.components).toHaveLength(1);
    expect(result.components[0]!.x).toBe(42);
    expect(result.components[0]!.y).toBe(99);
  });
});
