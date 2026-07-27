import { z } from "zod/v4";
import {
  DiscordApiMessageSchema,
  type DiscordApiMessage,
} from "#shared/glitter-corpus.ts";
import { glitterCorpusDiscordRequestsTotal } from "#observability/metrics.ts";
import {
  createGlitterDiscordRateLimitCoordinator,
  type GlitterDiscordRateLimitCoordinator,
} from "./glitter-corpus-rate-limit.ts";

const API_BASE_URL = "https://discord.com/api/v10";
const MAX_RETRIES = 8;
const MESSAGE_CONTENT_FLAGS = (1n << 18n) | (1n << 19n);

const RateLimitResponseSchema = z.looseObject({
  retry_after: z.number().nonnegative(),
  global: z.boolean().optional(),
});

type RateLimitMetadata = {
  limit: number | null;
  remaining: number | null;
  resetAfterSeconds: number | null;
  bucket: string | null;
};

export type DiscordRestResponse<T> = {
  data: T;
  rawBody: string;
  requestedAt: string;
  completedAt: string;
  retryCount: number;
  rateLimit: RateLimitMetadata;
};

export type DiscordRestProgress = {
  phase:
    | "global-rate-limit-wait"
    | "network-retry-wait"
    | "rate-limit-wait"
    | "server-retry-wait"
    | "request";
  path: string;
  attempt: number;
  delayMs: number;
};

export type DiscordRestClientHooks = {
  cancellationSignal: AbortSignal;
  onProgress: (progress: DiscordRestProgress) => void;
  wait: (delayMs: number, progress: DiscordRestProgress) => Promise<void>;
  rateLimitCoordinator?: GlitterDiscordRateLimitCoordinator;
};

function parseNullableIntegerHeader(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseNullableNumberHeader(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function rateLimitMetadata(headers: Headers): RateLimitMetadata {
  return {
    limit: parseNullableIntegerHeader(headers.get("x-ratelimit-limit")),
    remaining: parseNullableIntegerHeader(headers.get("x-ratelimit-remaining")),
    resetAfterSeconds: parseNullableNumberHeader(
      headers.get("x-ratelimit-reset-after"),
    ),
    bucket: headers.get("x-ratelimit-bucket"),
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error: unknown) {
    throw new Error("Discord returned invalid JSON", { cause: error });
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function retryDelayMs(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** attempt);
}

export function requireMessageContentIntent(input: {
  applicationId: string;
  botUserId: string;
  flags?: number;
  flagsNew?: string;
}): void {
  if (input.applicationId !== input.botUserId) {
    throw new Error(
      `Discord application ${input.applicationId} does not match bot user ${input.botUserId}`,
    );
  }
  const flags =
    input.flagsNew === undefined
      ? input.flags === undefined
        ? undefined
        : BigInt(input.flags)
      : BigInt(input.flagsNew);
  if (flags === undefined || (flags & MESSAGE_CONTENT_FLAGS) === 0n) {
    throw new Error(
      "Discord Message Content intent is not enabled; refusing to capture empty content fields",
    );
  }
}

export class DiscordRestClient {
  readonly #token: string;
  readonly #hooks: DiscordRestClientHooks | undefined;
  readonly #rateLimitCoordinator: GlitterDiscordRateLimitCoordinator;

  public constructor(token: string, hooks?: DiscordRestClientHooks) {
    if (token === "") {
      throw new Error("Discord archival bot token must not be empty");
    }
    this.#token = token;
    this.#hooks = hooks;
    this.#rateLimitCoordinator =
      hooks?.rateLimitCoordinator ?? createGlitterDiscordRateLimitCoordinator();
  }

  async #wait(delayMs: number, progress: DiscordRestProgress): Promise<void> {
    this.#hooks?.cancellationSignal.throwIfAborted();
    this.#hooks?.onProgress(progress);
    await (this.#hooks === undefined
      ? Bun.sleep(delayMs)
      : this.#hooks.wait(delayMs, progress));
    this.#hooks?.cancellationSignal.throwIfAborted();
  }

  async #waitForGlobalCeiling(
    path: string,
    attempt: number,
    holder: string,
  ): Promise<void> {
    for (;;) {
      const result = await this.#rateLimitCoordinator.tryAcquire({
        holder,
        nowMs: Date.now(),
      });
      if (result.acquired) {
        return;
      }
      await this.#wait(result.retryAfterMs, {
        phase: "global-rate-limit-wait",
        path,
        attempt,
        delayMs: result.retryAfterMs,
      });
    }
  }

  async #deferGlobalCeiling(
    path: string,
    attempt: number,
    holder: string,
    delayMs: number,
  ): Promise<void> {
    const notBeforeMs = Date.now() + delayMs;
    for (;;) {
      const updated = await this.#rateLimitCoordinator.tryDeferUntil({
        holder,
        notBeforeMs,
      });
      if (updated) {
        return;
      }
      await this.#wait(50, {
        phase: "global-rate-limit-wait",
        path,
        attempt,
        delayMs: 50,
      });
    }
  }

  async get<T>(
    path: string,
    schema: z.ZodType<T>,
  ): Promise<DiscordRestResponse<T>> {
    if (!path.startsWith("/")) {
      throw new Error(`Discord REST path must start with "/": ${path}`);
    }

    let attempt = 0;
    const rateLimitHolder = crypto.randomUUID();
    while (attempt <= MAX_RETRIES) {
      await this.#waitForGlobalCeiling(path, attempt, rateLimitHolder);
      this.#hooks?.onProgress({
        phase: "request",
        path,
        attempt,
        delayMs: 0,
      });
      const requestedAt = new Date().toISOString();
      let response: Response;
      try {
        const timeoutSignal = AbortSignal.timeout(30_000);
        response = await fetch(`${API_BASE_URL}${path}`, {
          headers: { Authorization: `Bot ${this.#token}` },
          signal:
            this.#hooks === undefined
              ? timeoutSignal
              : AbortSignal.any([
                  this.#hooks.cancellationSignal,
                  timeoutSignal,
                ]),
        });
      } catch (error: unknown) {
        this.#hooks?.cancellationSignal.throwIfAborted();
        if (attempt === MAX_RETRIES) {
          glitterCorpusDiscordRequestsTotal.inc({
            outcome: "fatal-network-error",
          });
          throw new Error(
            `Discord request failed after ${String(attempt + 1)} attempts: ${path}`,
            { cause: error },
          );
        }
        glitterCorpusDiscordRequestsTotal.inc({
          outcome: "retryable-network-error",
        });
        const delayMs = retryDelayMs(attempt);
        await this.#wait(delayMs, {
          phase: "network-retry-wait",
          path,
          attempt,
          delayMs,
        });
        attempt += 1;
        continue;
      }
      const completedAt = new Date().toISOString();
      const body = await response.text();
      const metadata = rateLimitMetadata(response.headers);
      if (metadata.remaining === 0 && metadata.resetAfterSeconds !== null) {
        await this.#deferGlobalCeiling(
          path,
          attempt,
          rateLimitHolder,
          Math.ceil(metadata.resetAfterSeconds * 1000),
        );
      }

      if (response.status === 401 || response.status === 403) {
        glitterCorpusDiscordRequestsTotal.inc({ outcome: "auth-failure" });
        throw new Error(
          `Discord authorization failed with ${String(response.status)} for ${path}; refusing to continue because corpus completeness cannot be proven`,
        );
      }
      if (response.ok) {
        glitterCorpusDiscordRequestsTotal.inc({ outcome: "success" });
        return {
          data: schema.parse(parseJson(body)),
          rawBody: body,
          requestedAt,
          completedAt,
          retryCount: attempt,
          rateLimit: metadata,
        };
      }
      if (!isRetryableStatus(response.status) || attempt === MAX_RETRIES) {
        glitterCorpusDiscordRequestsTotal.inc({ outcome: "fatal-error" });
        throw new Error(
          `Discord request failed with ${String(response.status)} for ${path}: ${body.slice(0, 500)}`,
        );
      }

      if (response.status === 429) {
        glitterCorpusDiscordRequestsTotal.inc({ outcome: "rate-limited" });
        const limited = RateLimitResponseSchema.parse(parseJson(body));
        const retryDelay = Math.ceil(limited.retry_after * 1000);
        await this.#deferGlobalCeiling(
          path,
          attempt,
          rateLimitHolder,
          retryDelay,
        );
        await this.#wait(retryDelay, {
          phase: "rate-limit-wait",
          path,
          attempt,
          delayMs: retryDelay,
        });
      } else {
        glitterCorpusDiscordRequestsTotal.inc({
          outcome: "retryable-server-error",
        });
        const delayMs = retryDelayMs(attempt);
        await this.#wait(delayMs, {
          phase: "server-retry-wait",
          path,
          attempt,
          delayMs,
        });
      }
      attempt += 1;
    }

    throw new Error(`Discord retry loop exhausted unexpectedly for ${path}`);
  }

  async getMessages(input: {
    channelId: string;
    before?: string;
    after?: string;
  }): Promise<DiscordRestResponse<DiscordApiMessage[]>> {
    if (input.before !== undefined && input.after !== undefined) {
      throw new Error("Discord messages request cannot set before and after");
    }
    const query = new URLSearchParams({ limit: "100" });
    if (input.before !== undefined) {
      query.set("before", input.before);
    }
    if (input.after !== undefined) {
      query.set("after", input.after);
    }
    return await this.get(
      `/channels/${input.channelId}/messages?${query.toString()}`,
      z.array(DiscordApiMessageSchema),
    );
  }
}
