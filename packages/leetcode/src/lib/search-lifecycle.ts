type EmbeddingProcess = {
  shutdown: () => Promise<void>;
};

export async function shutdownEmbeddingProcess(
  embedder: EmbeddingProcess | null,
): Promise<void> {
  if (embedder !== null) {
    await embedder.shutdown();
  }
}
