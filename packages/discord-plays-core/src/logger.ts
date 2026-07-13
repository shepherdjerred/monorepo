// Minimal structured-logger interface the core modules log through. Each game
// injects its own winston logger (packages/*/backend/src/logger.ts); this shape
// is the subset the shared code relies on and matches winston's leveled methods
// (`(message, ...meta)`), so a winston logger satisfies it directly.
export type Logger = {
  info: (message: string, ...meta: unknown[]) => void;
  warn: (message: string, ...meta: unknown[]) => void;
  error: (message: unknown, ...meta: unknown[]) => void;
};
