import type { Socket, SocketHandler, TCPSocketListener } from "bun";
import type { MailClientsMap } from "./auth.ts";
import type { MailSettings } from "./config.ts";
import type { MailMetrics } from "./metrics.ts";
import { completePlainAuth, handleLoginStep } from "./smtp-auth.ts";
import {
  MAX_SMTP_COMMAND_LINE_BYTES,
  extractSmtpDataFrame,
} from "./smtp-protocol.ts";
import {
  createSmtpSession,
  dispatchSmtpCommand,
  finalizeSmtpDataMessage,
  flushSmtpWrites,
  sendSmtpReply,
  type SmtpServerContext,
  type SmtpSession,
} from "./smtp-session.ts";
import type { MailStore } from "./store.ts";
import type { TlsCertificateLoader } from "./tls-loader.ts";

export type StartSmtpServerOptions = {
  readonly hostname: string;
  readonly port: number;
  readonly smtpHostname: string;
  readonly store: MailStore;
  readonly clients: MailClientsMap;
  readonly tlsLoader?: TlsCertificateLoader;
  readonly getSettings: () => Promise<MailSettings>;
  readonly onMessageQueued: () => void;
  readonly metrics?: MailMetrics;
  readonly now?: () => Date;
};

export type RunningSmtpServer = {
  readonly port: number;
  readonly hostname: string;
  readonly isListening: () => boolean;
  readonly stop: (closeActiveConnections?: boolean) => void;
};

async function processSingleSessionStep(
  ctx: SmtpServerContext,
  socket: Socket<SmtpSession>,
  session: SmtpSession,
): Promise<boolean> {
  if (session.mode === "data") {
    const frame = extractSmtpDataFrame(session.buffer, session.dataOverflow);
    if (frame.kind === "incomplete") {
      session.buffer = frame.retainedBuffer;
      session.dataOverflow = frame.overflowed;
      return false;
    }
    session.buffer = frame.remainingBuffer;
    await finalizeSmtpDataMessage(ctx, socket, session, frame);
    return true;
  }

  const lfIdx = session.buffer.indexOf(0x0a);
  if (lfIdx === -1) {
    if (session.buffer.length > MAX_SMTP_COMMAND_LINE_BYTES) {
      session.buffer = Buffer.alloc(0);
      sendSmtpReply(socket, session, "500 5.5.2 Command line too long\r\n");
    }
    return false;
  }

  if (lfIdx > MAX_SMTP_COMMAND_LINE_BYTES) {
    session.buffer = Buffer.from(session.buffer.subarray(lfIdx + 1));
    sendSmtpReply(socket, session, "500 5.5.2 Command line too long\r\n");
    return true;
  }

  const rawLine = session.buffer
    .subarray(0, lfIdx)
    .toString("utf8")
    .replace(/\r+$/u, "");
  session.buffer = Buffer.from(session.buffer.subarray(lfIdx + 1));

  if (session.mode === "auth_plain") {
    completePlainAuth(ctx, socket, session, rawLine);
    return true;
  }
  if (
    session.mode === "auth_login_user" ||
    session.mode === "auth_login_pass"
  ) {
    handleLoginStep(ctx, socket, session, rawLine);
    return true;
  }
  await dispatchSmtpCommand(ctx, socket, session, rawLine);
  return true;
}

async function processSessionBuffer(
  ctx: SmtpServerContext,
  socket: Socket<SmtpSession>,
  session: SmtpSession,
): Promise<void> {
  if (session.processing) {
    return;
  }
  session.processing = true;
  try {
    while (!session.closed && !session.upgradingTls) {
      const keepGoing = await processSingleSessionStep(ctx, socket, session);
      if (!keepGoing) {
        break;
      }
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        service: "mail",
        message: "smtp_session_error",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    if (!session.closed) {
      sendSmtpReply(
        socket,
        session,
        "451 4.3.0 Requested action aborted: local error in processing\r\n",
      );
      session.closed = true;
      socket.end();
    }
  } finally {
    session.processing = false;
  }
}

export function startSmtpServer(
  options: StartSmtpServerOptions,
): RunningSmtpServer {
  let stopped = false;

  function buildHandlers(isUpgradedTls: boolean): SocketHandler<SmtpSession> {
    return {
      open(socket) {
        if (!isUpgradedTls) {
          const fresh = createSmtpSession(false);
          socket.data = fresh;
          sendSmtpReply(
            socket,
            fresh,
            `220 ${options.smtpHostname} ESMTP Service ready\r\n`,
          );
        }
      },
      data(socket, chunk) {
        const session = socket.data;
        if (session.closed || session.upgradingTls) {
          return;
        }
        session.buffer =
          session.buffer.length === 0
            ? Buffer.from(chunk)
            : Buffer.concat([session.buffer, chunk]);
        void processSessionBuffer(ctx, socket, session);
      },
      drain(socket) {
        flushSmtpWrites(socket, socket.data);
      },
      close(socket) {
        socket.data.closed = true;
      },
      error(socket, error) {
        socket.data.closed = true;
        console.warn(
          JSON.stringify({
            level: "warn",
            service: "mail",
            message: "smtp_socket_error",
            error: error.message,
          }),
        );
      },
    };
  }

  const tlsHandlers = buildHandlers(true);
  const ctx: SmtpServerContext = {
    smtpHostname: options.smtpHostname,
    store: options.store,
    clients: options.clients,
    ...(options.tlsLoader === undefined
      ? {}
      : { tlsLoader: options.tlsLoader }),
    getSettings: options.getSettings,
    onMessageQueued: options.onMessageQueued,
    ...(options.metrics === undefined ? {} : { metrics: options.metrics }),
    now: options.now ?? (() => new Date()),
    getTlsHandlers: () => tlsHandlers,
  };

  const listener: TCPSocketListener<SmtpSession> = Bun.listen<SmtpSession>({
    hostname: options.hostname,
    port: options.port,
    socket: buildHandlers(false),
  });

  return {
    port: listener.port,
    hostname: listener.hostname,
    isListening: () => !stopped,
    stop(closeActiveConnections = true) {
      if (stopped) {
        return;
      }
      stopped = true;
      listener.stop(closeActiveConnections);
    },
  };
}
