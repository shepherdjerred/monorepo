import * as Sentry from "@sentry/bun";
import { bugsinkDataCollection } from "@shepherdjerred/bugsink-config";
import type { SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { createGameBot } from "@shepherdjerred/discord-stream-lifecycle/lifecycle/game-bot";
import type {
  CreateGameBotOptions,
  GameBotRuntime,
} from "@shepherdjerred/discord-stream-lifecycle/lifecycle/game-bot";
import { createSelfbotPooledUserbotFactory } from "@shepherdjerred/discord-stream-lifecycle/pool/selfbot-client";
import type { SelfbotPooledUserbot } from "@shepherdjerred/discord-stream-lifecycle/pool/selfbot-client";
import { initializeTracing } from "#src/observability/tracing.ts";
import type { Logger } from "#src/logger.ts";

// Peer userbot Discord user IDs supplied by the deployment (homelab cdk8s defines the
// canonical list and passes each bot its peers as "all - self" via PEER_USERBOT_IDS).
// Empty when running locally; the Go-Live heuristic then catches peer userbots instead.
export function readPeerUserbotIds(): readonly string[] {
  const raw = Bun.env["PEER_USERBOT_IDS"];
  return raw === undefined
    ? []
    : raw
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id.length > 0);
}

// The subset of createGameBot options each game supplies; the rest (userbot
// factory, peer ids, alone-grace) is filled in here so every game boots identically.
type GameBotWiring = Pick<
  CreateGameBotOptions<SelfbotPooledUserbot>,
  | "botToken"
  | "applicationId"
  | "userbotTokens"
  | "driver"
  | "stateRootDir"
  | "saveHistory"
  | "extraCommands"
  | "stoppedMessage"
>;

export type BootGameBotOptions = {
  /** Resource `service.name` for tracing (e.g. "discord-plays-pokemon"). */
  serviceName: string;
  /** Bugsink DSN fallback baked per game; BUGSINK_DSN env overrides it. */
  bugsinkDsn: string;
  /** Structured logger the shared modules log through (the game's winston logger). */
  logger: Logger;
  /** createGameBot inputs the game provides. */
  wiring: GameBotWiring;
  /**
   * Optional span-processor wrapper for tracing (pokemon inserts llm-observability's
   * archive layer here so that dependency stays out of core).
   */
  wrapSpanProcessor?: (processor: SpanProcessor) => SpanProcessor;
  /** Extra teardown run during shutdown before the process exits (e.g. disconnect Prisma). */
  onShutdown?: () => Promise<void>;
};

/**
 * Boot a discord-plays game bot: initialise Bugsink + OTLP tracing, build the
 * createGameBot runtime, and arm SIGTERM/SIGINT handlers. Returns the runtime so
 * the game can wire its message/socket dispatch and then call `runtime.start()`.
 *
 * Sentry.init runs first with `enableOpenTelemetrySetup: false` so it doesn't
 * register the global OTel TracerProvider before initializeTracing()'s NodeSDK
 * does (otherwise spans route through the Sentry SDK's sampler and never reach Tempo).
 */
export function bootGameBot(
  options: BootGameBotOptions,
): GameBotRuntime<SelfbotPooledUserbot> {
  initializeGameObservability(options);

  const runtime = createGameBot<SelfbotPooledUserbot>({
    ...options.wiring,
    userbotFactory: createSelfbotPooledUserbotFactory(),
    aloneGraceMs: 30_000,
    peerUserbotIds: readPeerUserbotIds(),
    logger: {
      info: (message, metadata) => {
        options.logger.info(message, metadata);
      },
      warn: (message, metadata) => {
        options.logger.warn(message, metadata);
      },
      error: (message, metadata) => {
        options.logger.error(message, metadata);
      },
    },
  });

  async function shutdownAndExit(): Promise<void> {
    await runtime.shutdown();
    await options.onShutdown?.();
    process.exit(0);
  }
  process.once("SIGTERM", () => {
    void shutdownAndExit();
  });
  process.once("SIGINT", () => {
    void shutdownAndExit();
  });
  return runtime;
}

/** Shared process observability, independent of a single-slot game bot. */
export function initializeGameObservability(
  options: Pick<
    BootGameBotOptions,
    "serviceName" | "bugsinkDsn" | "logger" | "wrapSpanProcessor"
  >,
): void {
  Sentry.init({
    dataCollection: bugsinkDataCollection(),
    dsn: Bun.env["BUGSINK_DSN"] ?? options.bugsinkDsn,
    environment: Bun.env.NODE_ENV ?? "development",
    // VERSION is baked into the image at build time.
    release: Bun.env["VERSION"],
    // Don't let the Sentry SDK register the global OTel TracerProvider/Propagator/
    // ContextManager. It runs before initializeTracing(), so it lands first and
    // the NodeSDK below fails registration ("duplicate registration of API:
    // trace") — spans then route through the Sentry SDK's sampler (tracesSampleRate
    // unset) and never reach Tempo. The Sentry SDK stays for errors via captureException.
    enableOpenTelemetrySetup: false,
  });

  // Start OTLP tracing before any traced network work (Discord login, voice).
  initializeTracing({
    serviceName: options.serviceName,
    logger: options.logger,
    ...(options.wrapSpanProcessor === undefined
      ? {}
      : { wrapSpanProcessor: options.wrapSpanProcessor }),
  });
}
