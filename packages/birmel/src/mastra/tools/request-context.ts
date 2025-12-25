import { AsyncLocalStorage } from "async_hooks";

export type RequestContext = {
  /** The channel where the user's message originated */
  sourceChannelId: string;
  /** The guild where the request originated */
  guildId: string;
  /** The user who sent the message */
  userId: string;
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
