import { describe, expect, test } from "vitest";
import type {
  ArtifactSummary,
  ThreadView,
} from "@shepherdjerred/artifacts/procedures";
import {
  canvasPins,
  boardPoint,
  readingOrder,
  type CanvasFrameModel,
} from "./model.ts";

function box(id: string, x: number, y: number) {
  return { id, rect: { x, y, w: 600, h: 400 } };
}

function thread(overrides: Partial<ThreadView>): ThreadView {
  return {
    id: "t",
    boardId: "b",
    artifactId: null,
    versionId: null,
    versionNumber: null,
    anchor: { type: "general" },
    state: "open",
    createdAt: "2026-11-26T00:00:00.000Z",
    resolvedAt: null,
    comments: [],
    ...overrides,
  };
}

const PUBLISHER = {
  key: "agent:karpathy",
  kind: "agent",
  name: "karpathy",
} as const;

function summaryAt(version: number): ArtifactSummary {
  return {
    id: "frame-1",
    boardId: "board-1",
    boardSlug: "demo",
    boardTitle: "Demo",
    title: "Concept A",
    kind: "html",
    ownerKey: "karpathy:/work",
    createdAt: "2026-11-26T00:00:00.000Z",
    versionCount: version,
    openThreadCount: 0,
    currentVersion: {
      id: "version-1",
      artifactId: "frame-1",
      number: version,
      entryPath: "index.html",
      totalBytes: 100,
      fileCount: 1,
      note: "",
      viewport: null,
      createdAt: "2026-11-26T00:00:00.000Z",
      publisher: PUBLISHER,
      purged: false,
    },
  };
}

describe("reading order", () => {
  test("rows top to bottom, left to right inside a row", () => {
    const frames = [
      box("c", 1400, 20),
      box("d", 0, 900),
      box("a", 0, 0),
      box("b", 700, 90),
    ];
    expect(readingOrder(frames).map((frame) => frame.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  test("a frame well below the row starts the next one", () => {
    const frames = [box("a", 900, 0), box("b", 0, 300)];
    expect(readingOrder(frames).map((frame) => frame.id)).toEqual(["a", "b"]);
  });

  test("does not mutate its input", () => {
    const frames = [box("b", 700, 0), box("a", 0, 0)];
    readingOrder(frames);
    expect(frames.map((frame) => frame.id)).toEqual(["b", "a"]);
  });
});

describe("pins", () => {
  const frame: CanvasFrameModel = {
    id: "frame-1",
    rect: { x: 0, y: 0, w: 640, h: 420 },
    z: 0,
    summary: summaryAt(2),
  };
  const frames = new Map([[frame.id, frame]]);

  test("a board comment at the origin is not a pin", () => {
    expect(boardPoint({ type: "board", page: 0, x: 0, y: 0 })).toBeNull();
    expect(boardPoint({ type: "board", page: 0, x: 10, y: 0 })).toEqual({
      x: 10,
      y: 0,
    });
    expect(boardPoint({ type: "general" })).toBeNull();
  });

  test("selects board pins and pins on frames of the board, numbered by thread", () => {
    const pins = canvasPins(
      [
        thread({ id: "general" }),
        thread({
          id: "origin",
          anchor: { type: "board", page: 0, x: 0, y: 0 },
        }),
        thread({
          id: "board",
          anchor: { type: "board", page: 0, x: 120, y: 80 },
        }),
        thread({
          id: "on-frame",
          artifactId: "frame-1",
          versionNumber: 2,
          anchor: { type: "frame", x: 0.5, y: 0.5 },
        }),
        thread({
          id: "old",
          artifactId: "frame-1",
          versionNumber: 1,
          anchor: { type: "frame", x: 0.1, y: 0.1 },
        }),
        thread({
          id: "elsewhere",
          artifactId: "other",
          anchor: { type: "frame", x: 0.1, y: 0.1 },
        }),
      ],
      frames,
    );
    expect(
      pins.map((pin) => [pin.id, pin.index, pin.frameId, pin.stale]),
    ).toEqual([
      ["board", 3, null, false],
      ["on-frame", 4, "frame-1", false],
      ["old", 5, "frame-1", true],
    ]);
  });
});
