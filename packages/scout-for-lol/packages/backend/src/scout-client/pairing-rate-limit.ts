const WINDOW_MS = 60_000;
const PER_CALLER_LIMIT = 5;
const GLOBAL_LIMIT = 100;
const MAX_TRACKED_CALLERS = 5000;

let windowStartedAt = Date.now();
let globalCalls = 0;
const callsByCaller = new Map<string, number>();

function callerKey(request: Request): string {
  const forwarded =
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim();
  return forwarded === undefined ||
    forwarded.length === 0 ||
    forwarded.length > 128
    ? "unknown"
    : forwarded;
}

/** Bound anonymous pairing writes per edge caller and per backend process. */
export function pairingCreationAllowed(
  request: Request,
  now = Date.now(),
): boolean {
  if (now - windowStartedAt >= WINDOW_MS) {
    windowStartedAt = now;
    globalCalls = 0;
    callsByCaller.clear();
  }
  const caller = callerKey(request);
  const calls = (callsByCaller.get(caller) ?? 0) + 1;
  if (calls > PER_CALLER_LIMIT) return false;

  if (globalCalls >= GLOBAL_LIMIT) return false;
  globalCalls += 1;
  if (calls > 1 || callsByCaller.size < MAX_TRACKED_CALLERS) {
    callsByCaller.set(caller, calls);
  }
  return true;
}

export function resetPairingRateLimitForTests(now = Date.now()): void {
  windowStartedAt = now;
  globalCalls = 0;
  callsByCaller.clear();
}
