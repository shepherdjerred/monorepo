type SSEListener = (data: string) => void;

const listeners = new Set<SSEListener>();

export function addSSEListener(listener: SSEListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitSSE(event: Record<string, unknown>): void {
  const data = JSON.stringify(event);
  for (const listener of listeners) {
    listener(data);
  }
}
