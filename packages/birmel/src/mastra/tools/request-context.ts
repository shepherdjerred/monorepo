import { AsyncLocalStorage } from "node:async_hooks";

export type RequestContext = {
  /** The channel where the user's message originated */
  sourceChannelId: string;
  /** The message ID that triggered this request (for reply action) */
  sourceMessageId: string;
  /** The guild where the request originated */
  guildId: string;
  /** The user who sent the message */
  userId: string;
  /** Whether a reply has already been sent for this request (prevents spam) */
  replySent?: boolean;
};

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

/**
 * Run a function with request context available to tools.
 * Tools can call getRequestContext() to access this context.
 */
export function runWithRequestContext<T>(
  context: RequestContext,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return requestContextStorage.run(context, fn);
}

/**
 * Get the current request context.
 * Returns undefined if not running within runWithRequestContext.
 */
export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

/**
 * Mark that a reply has been sent for the current request.
 * This prevents multiple replies to the same message.
 */
export function markReplySent(): void {
  const context = requestContextStorage.getStore();
  if (context) {
    context.replySent = true;
  }
}

/**
 * Check if a reply has already been sent for the current request.
 */
export function hasReplySent(): boolean {
  const context = requestContextStorage.getStore();
  return context?.replySent === true;
}
