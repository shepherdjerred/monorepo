export type ExcalidrawWatcher = {
  stop: () => void;
};

export function watchExcalidraw(
  filePath: string,
  onChange: (content: string) => void,
  debounceMs = 2000,
): ExcalidrawWatcher {
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let lastModified = 0;

  async function readAndNotify(): Promise<void> {
    try {
      const content = await Bun.file(filePath).text();
      onChange(content);
    } catch {
      // File may have been deleted; ignore read errors
    }
  }

  function pollForChanges(): void {
    if (stopped) return;
    try {
      const file = Bun.file(filePath);
      const modified = file.lastModified;
      if (modified > lastModified && lastModified > 0) {
        if (debounceTimer !== undefined) {
          clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(() => {
          void readAndNotify();
        }, debounceMs);
      }
      lastModified = modified;
    } catch {
      // File may not exist yet
    }
  }

  // Initialize lastModified
  try {
    lastModified = Bun.file(filePath).lastModified;
  } catch {
    // File may not exist yet
  }

  const pollInterval = setInterval(() => {
    pollForChanges();
  }, 500);

  return {
    stop(): void {
      stopped = true;
      if (debounceTimer !== undefined) {
        clearTimeout(debounceTimer);
      }
      clearInterval(pollInterval);
    },
  };
}
