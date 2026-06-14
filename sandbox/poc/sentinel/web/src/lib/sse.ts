type SSEListener = (data: unknown) => void;

const listeners = new Map<string, Set<SSEListener>>();
let eventSource: EventSource | null = null;

function handleMessage(event: MessageEvent): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(event.data)) as unknown;
  } catch {
    return;
  }
  if (typeof parsed !== "object" || parsed == null || !("type" in parsed))
    return;
  const obj: Record<string, unknown> = Object.assign({}, parsed);
  const type = typeof obj.type === "string" ? obj.type : undefined;
  if (type == null) return;
  const typeListeners = listeners.get(type);
  if (typeListeners != null) {
    for (const listener of typeListeners) {
      listener(parsed);
    }
  }
}

function handleError(): void {
  eventSource?.close();
  eventSource = null;
  setTimeout(() => {
    if (listeners.size > 0) connect();
  }, 3000);
}

function connect(): void {
  if (eventSource != null) return;

  eventSource = new EventSource("/api/events");
  eventSource.addEventListener("message", handleMessage);
  eventSource.addEventListener("error", handleError);
}

function disconnect(): void {
  if (eventSource != null) {
    eventSource.removeEventListener("message", handleMessage);
    eventSource.removeEventListener("error", handleError);
    eventSource.close();
    eventSource = null;
  }
}

export function addSSEListener(
  eventType: string,
  callback: SSEListener,
): () => void {
  let typeListeners = listeners.get(eventType);
  if (typeListeners == null) {
    typeListeners = new Set();
    listeners.set(eventType, typeListeners);
  }
  typeListeners.add(callback);

  if (eventSource == null) connect();

  return () => {
    typeListeners.delete(callback);
    if (typeListeners.size === 0) {
      listeners.delete(eventType);
    }
    if (listeners.size === 0) disconnect();
  };
}
