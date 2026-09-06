import { AsyncLocalStorage } from "node:async_hooks";

export type StagedAttachment = {
  data: Buffer | Uint8Array;
  name: string;
  description?: string;
  contentType?: string;
};

export type RequestContext = {
  /** The channel where the user's message originated */
  sourceChannelId: string;
  /** The message ID that triggered this request (for reply action) */
  sourceMessageId: string;
  /** The guild where the request originated */
  guildId: string;
  /** Compact elected persona identifier for persona-scoped memory */
  personaId?: string;
  /** The user who sent the message */
  userId: string;
  /** Whether a reply has already been sent for this request (prevents spam) */
  replySent?: boolean;
  /** Whether the live turn runtime owns the source-channel reply. */
  ownsSourceReply: boolean;
  /** Whether this turn performed a forget/privacy erase operation. */
  suppressAutomaticMemoryExtraction?: boolean;
  /** Internal durable-job hook invoked immediately before a write-risk tool. */
  beforeExternalEffect?: () => Promise<void>;
  /** Attachments staged by tools to be delivered with the single Discord reply. */
  stagedAttachments?: StagedAttachment[];
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
  if (context != null) {
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

export function suppressAutomaticMemoryExtraction(): void {
  const context = requestContextStorage.getStore();
  if (context != null) {
    context.suppressAutomaticMemoryExtraction = true;
  }
}

export function stageAttachment(attachment: StagedAttachment): void {
  const context = requestContextStorage.getStore();
  if (context != null) {
    context.stagedAttachments ??= [];
    context.stagedAttachments.push(attachment);
  }
}

export function getStagedAttachments(
  context?: RequestContext,
): readonly StagedAttachment[] {
  return (context ?? requestContextStorage.getStore())?.stagedAttachments ?? [];
}
