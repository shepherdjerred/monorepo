import {
  parseElements,
  type DiagramExtraction,
} from "#lib/excalidraw/parser.ts";
import {
  codeDiff,
  excalidrawSemanticDiff,
  type LineDiff,
  type SemanticDiff,
} from "./differ.ts";

export type SnapshotEntry = {
  timestamp: number;
  source: "code" | "excalidraw";
  codeDiff: LineDiff | undefined;
  diagramDiff: SemanticDiff | undefined;
};

export type SnapshotCollector = {
  getSnapshots: () => readonly SnapshotEntry[];
  getLatestCodeDiff: () => LineDiff | undefined;
  getLatestDiagramDiff: () => SemanticDiff | undefined;
  stop: () => void;
};

async function tryReadFile(filePath: string): Promise<string | undefined> {
  try {
    return await Bun.file(filePath).text();
  } catch {
    return undefined;
  }
}

export function createSnapshotCollector(
  solutionPath: string,
  excalidrawPath: string | undefined,
  debounceMs = 2000,
): SnapshotCollector {
  const snapshots: SnapshotEntry[] = [];
  let lastCodeContent = "";
  let lastDiagramExtraction: DiagramExtraction | undefined;
  let stopped = false;

  let codeLastModified = 0;
  let diagramLastModified = 0;
  let codeDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  let diagramDebounceTimer: ReturnType<typeof setTimeout> | undefined;

  async function initializeCodeContent(): Promise<void> {
    const content = await tryReadFile(solutionPath);
    if (content !== undefined) {
      lastCodeContent = content;
    }
  }

  async function initializeDiagramContent(diagPath: string): Promise<void> {
    const content = await tryReadFile(diagPath);
    if (content !== undefined) {
      try {
        lastDiagramExtraction = parseElements(content);
      } catch {
        // Invalid excalidraw file
      }
    }
  }

  void initializeCodeContent();
  if (excalidrawPath !== undefined) {
    void initializeDiagramContent(excalidrawPath);
  }

  // Initialize lastModified timestamps
  try {
    codeLastModified = Bun.file(solutionPath).lastModified;
  } catch {
    // File may not exist yet
  }
  if (excalidrawPath !== undefined) {
    try {
      diagramLastModified = Bun.file(excalidrawPath).lastModified;
    } catch {
      // File may not exist yet
    }
  }

  async function handleCodeChange(): Promise<void> {
    const content = await tryReadFile(solutionPath);
    if (content === undefined) return;

    const diff = codeDiff(lastCodeContent, content);
    if (diff.added.length > 0 || diff.removed.length > 0) {
      snapshots.push({
        timestamp: Date.now(),
        source: "code",
        codeDiff: diff,
        diagramDiff: undefined,
      });
      lastCodeContent = content;
    }
  }

  async function handleDiagramChange(filePath: string): Promise<void> {
    const content = await tryReadFile(filePath);
    if (content === undefined) return;

    try {
      const newExtraction = parseElements(content);
      if (lastDiagramExtraction !== undefined) {
        const diff = excalidrawSemanticDiff(
          lastDiagramExtraction,
          newExtraction,
        );
        const hasChanges =
          diff.addedComponents.length > 0 ||
          diff.removedComponents.length > 0 ||
          diff.modifiedComponents.length > 0 ||
          diff.addedConnections.length > 0 ||
          diff.removedConnections.length > 0;
        if (hasChanges) {
          snapshots.push({
            timestamp: Date.now(),
            source: "excalidraw",
            codeDiff: undefined,
            diagramDiff: diff,
          });
        }
      }
      lastDiagramExtraction = newExtraction;
    } catch {
      // Invalid JSON
    }
  }

  function poll(): void {
    if (stopped) return;

    // Poll code file
    try {
      const modified = Bun.file(solutionPath).lastModified;
      if (modified > codeLastModified && codeLastModified > 0) {
        if (codeDebounceTimer !== undefined) {
          clearTimeout(codeDebounceTimer);
        }
        codeDebounceTimer = setTimeout(() => {
          void handleCodeChange();
        }, debounceMs);
      }
      codeLastModified = modified;
    } catch {
      // File may not exist
    }

    // Poll diagram file
    if (excalidrawPath !== undefined) {
      try {
        const modified = Bun.file(excalidrawPath).lastModified;
        if (modified > diagramLastModified && diagramLastModified > 0) {
          if (diagramDebounceTimer !== undefined) {
            clearTimeout(diagramDebounceTimer);
          }
          const diagPath = excalidrawPath;
          diagramDebounceTimer = setTimeout(() => {
            void handleDiagramChange(diagPath);
          }, debounceMs);
        }
        diagramLastModified = modified;
      } catch {
        // File may not exist
      }
    }
  }

  const pollInterval = setInterval(() => {
    poll();
  }, 500);

  return {
    getSnapshots(): readonly SnapshotEntry[] {
      return snapshots;
    },

    getLatestCodeDiff(): LineDiff | undefined {
      for (let i = snapshots.length - 1; i >= 0; i--) {
        const entry = snapshots[i];
        if (entry?.source === "code" && entry.codeDiff !== undefined) {
          return entry.codeDiff;
        }
      }
      return undefined;
    },

    getLatestDiagramDiff(): SemanticDiff | undefined {
      for (let i = snapshots.length - 1; i >= 0; i--) {
        const entry = snapshots[i];
        if (entry?.source === "excalidraw" && entry.diagramDiff !== undefined) {
          return entry.diagramDiff;
        }
      }
      return undefined;
    },

    stop(): void {
      stopped = true;
      clearInterval(pollInterval);
      if (codeDebounceTimer !== undefined) {
        clearTimeout(codeDebounceTimer);
      }
      if (diagramDebounceTimer !== undefined) {
        clearTimeout(diagramDebounceTimer);
      }
    },
  };
}
