import type { Socket, SocketHandler } from "bun";
import {
  isSenderDomainAllowed,
  type AuthenticatedMailClient,
  type MailClientsMap,
} from "./auth.ts";
import type { MailSettings } from "./config.ts";
import type { MailMetrics } from "./metrics.ts";
import { parseInboundMime } from "./mime.ts";
import { handleSmtpAuthCommand } from "./smtp-auth.ts";
import {
  MAX_SMTP_MESSAGE_BYTES,
  MAX_SMTP_RECIPIENTS,
  formatEhloResponse,
  parseEnvelopeAddressCommand,
} from "./smtp-protocol.ts";
import type { MailStore } from "./store.ts";
import type { TlsCertificateLoader } from "./tls-loader.ts";

const TEN_MINUTES_MS = 10 * 60 * 1000;

export type SmtpSessionMode =
  "command" | "auth_plain" | "auth_login_user" | "auth_login_pass" | "data";

export type SmtpSession = {
  isTls: boolean;
  closed: boolean;
  upgradingTls: boolean;
  processing: boolean;
  mode: SmtpSessionMode;
  helo: string | null;
  authenticatedClient: AuthenticatedMailClient | null;
  pendingLoginUsername: string | null;
  mailFrom: string | null;
  rcptTo: string[];
  buffer: Buffer;
  dataOverflow: boolean;
  writeQueue: Buffer[];
};

export type SmtpServerContext = {
  readonly smtpHostname: string;
  readonly store: MailStore;
  readonly clients: MailClientsMap;
  readonly tlsLoader?: TlsCertificateLoader;
  readonly getSettings: () => Promise<MailSettings>;
  readonly onMessageQueued: () => void;
  readonly metrics?: MailMetrics;
  readonly now: () => Date;
  readonly getTlsHandlers: () => SocketHandler<SmtpSession>;
};

export function createSmtpSession(isTls: boolean): SmtpSession {
  return {
    isTls,
    closed: false,
    upgradingTls: false,
    processing: false,
    mode: "command",
    helo: null,
    authenticatedClient: null,
    pendingLoginUsername: null,
    mailFrom: null,
    rcptTo: [],
    buffer: Buffer.alloc(0),
    dataOverflow: false,
    writeQueue: [],
  };
}

export function flushSmtpWrites(
  socket: Socket<SmtpSession>,
  session: SmtpSession,
): void {
  while (session.writeQueue.length > 0 && !session.closed) {
    const head = session.writeQueue[0];
    if (head === undefined) {
      break;
    }
    const written = socket.write(head);
    if (written >= head.length) {
      session.writeQueue.shift();
    } else {
      if (written > 0) {
        session.writeQueue[0] = head.subarray(written);
      }
      break;
    }
  }
}

export function sendSmtpReply(
  socket: Socket<SmtpSession>,
  session: SmtpSession,
  reply: string,
): void {
  if (session.closed) {
    return;
  }
  session.writeQueue.push(Buffer.from(reply, "utf8"));
  flushSmtpWrites(socket, session);
}

function resetEnvelope(session: SmtpSession): void {
  session.mailFrom = null;
  session.rcptTo = [];
  session.dataOverflow = false;
  session.mode = "command";
}

function handleMailFrom(
  socket: Socket<SmtpSession>,
  session: SmtpSession,
  arg: string,
): void {
  if (session.helo === null) {
    sendSmtpReply(socket, session, "503 5.5.1 Send EHLO/HELO first\r\n");
    return;
  }
  if (session.authenticatedClient === null) {
    sendSmtpReply(socket, session, "530 5.7.0 Authentication required\r\n");
    return;
  }
  if (session.mailFrom !== null) {
    sendSmtpReply(socket, session, "503 5.5.1 Nested MAIL command\r\n");
    return;
  }
  const parsed = parseEnvelopeAddressCommand(arg, "FROM:");
  if (parsed.kind === "invalid_syntax") {
    sendSmtpReply(socket, session, "501 5.5.4 Syntax: MAIL FROM:<address>\r\n");
    return;
  }
  if (parsed.kind === "invalid_address") {
    sendSmtpReply(socket, session, "501 5.1.7 Invalid sender address\r\n");
    return;
  }
  if (
    parsed.declaredSize !== null &&
    parsed.declaredSize > MAX_SMTP_MESSAGE_BYTES
  ) {
    sendSmtpReply(
      socket,
      session,
      "552 5.3.4 Message size exceeds fixed maximum message size\r\n",
    );
    return;
  }
  if (
    !isSenderDomainAllowed(parsed.address, session.authenticatedClient.config)
  ) {
    sendSmtpReply(
      socket,
      session,
      "550 5.7.1 Sender domain not authorized\r\n",
    );
    return;
  }
  session.mailFrom = parsed.address;
  session.rcptTo = [];
  sendSmtpReply(socket, session, "250 2.1.0 Ok\r\n");
}

function handleRcptTo(
  socket: Socket<SmtpSession>,
  session: SmtpSession,
  arg: string,
): void {
  if (session.mailFrom === null) {
    sendSmtpReply(socket, session, "503 5.5.1 Need MAIL command\r\n");
    return;
  }
  const parsed = parseEnvelopeAddressCommand(arg, "TO:");
  if (parsed.kind === "invalid_syntax") {
    sendSmtpReply(socket, session, "501 5.5.4 Syntax: RCPT TO:<address>\r\n");
    return;
  }
  if (parsed.kind === "invalid_address") {
    sendSmtpReply(socket, session, "501 5.1.3 Invalid recipient address\r\n");
    return;
  }
  if (session.rcptTo.length >= MAX_SMTP_RECIPIENTS) {
    sendSmtpReply(socket, session, "452 4.5.3 Too many recipients\r\n");
    return;
  }
  session.rcptTo.push(parsed.address);
  sendSmtpReply(socket, session, "250 2.1.5 Ok\r\n");
}

function handleDataStart(
  socket: Socket<SmtpSession>,
  session: SmtpSession,
  arg: string,
): void {
  if (arg.trim().length > 0) {
    sendSmtpReply(socket, session, "501 5.5.4 DATA takes no parameters\r\n");
    return;
  }
  if (session.mailFrom === null) {
    sendSmtpReply(socket, session, "503 5.5.1 Need MAIL command\r\n");
    return;
  }
  if (session.rcptTo.length === 0) {
    sendSmtpReply(socket, session, "503 5.5.1 Need RCPT command\r\n");
    return;
  }
  session.mode = "data";
  session.dataOverflow = false;
  sendSmtpReply(socket, session, "354 End data with <CR><LF>.<CR><LF>\r\n");
}

async function handleStartTls(
  ctx: SmtpServerContext,
  socket: Socket<SmtpSession>,
  session: SmtpSession,
  arg: string,
): Promise<void> {
  if (arg.trim().length > 0) {
    sendSmtpReply(
      socket,
      session,
      "501 5.5.4 Syntax error (no parameters allowed)\r\n",
    );
    return;
  }
  if (ctx.tlsLoader === undefined) {
    sendSmtpReply(socket, session, "454 4.7.0 TLS not available\r\n");
    return;
  }
  if (session.isTls) {
    sendSmtpReply(socket, session, "503 5.5.1 TLS already active\r\n");
    return;
  }

  let tlsMaterial;
  try {
    tlsMaterial = await ctx.tlsLoader.load();
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        service: "mail",
        message: "smtp_tls_cert_load_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    sendSmtpReply(socket, session, "454 4.7.0 Temporary TLS failure\r\n");
    return;
  }

  ctx.metrics?.smtpTlsCertExpiryTimestampSeconds.set(
    tlsMaterial.expiresAtEpochSeconds,
  );

  session.upgradingTls = true;
  session.buffer = Buffer.alloc(0);
  socket.write("220 2.0.0 Ready to start TLS\r\n");

  socket.upgradeTLS({
    data: createSmtpSession(true),
    tls: { cert: tlsMaterial.cert, key: tlsMaterial.key },
    socket: ctx.getTlsHandlers(),
  });
}

async function handleEhlo(
  ctx: SmtpServerContext,
  socket: Socket<SmtpSession>,
  session: SmtpSession,
  arg: string,
): Promise<void> {
  const domain = arg.trim();
  if (domain.length === 0) {
    sendSmtpReply(socket, session, "501 5.5.4 Syntax: EHLO hostname\r\n");
    return;
  }
  resetEnvelope(session);
  session.helo = domain;
  const settings = await ctx.getSettings();
  const hasTls = ctx.tlsLoader !== undefined;
  sendSmtpReply(
    socket,
    session,
    formatEhloResponse({
      hostname: ctx.smtpHostname,
      advertiseStartTls: hasTls && !session.isTls,
      advertiseAuth:
        session.isTls || !hasTls || settings.allowCleartextSmtpAuth,
    }),
  );
}

function handleHelo(
  ctx: SmtpServerContext,
  socket: Socket<SmtpSession>,
  session: SmtpSession,
  arg: string,
): void {
  const domain = arg.trim();
  if (domain.length === 0) {
    sendSmtpReply(socket, session, "501 5.5.4 Syntax: HELO hostname\r\n");
    return;
  }
  resetEnvelope(session);
  session.helo = domain;
  sendSmtpReply(socket, session, `250 ${ctx.smtpHostname}\r\n`);
}

export async function finalizeSmtpDataMessage(
  ctx: SmtpServerContext,
  socket: Socket<SmtpSession>,
  session: SmtpSession,
  input: { readonly rawMime: Uint8Array; readonly overflowed: boolean },
): Promise<void> {
  const authClient = session.authenticatedClient;
  const mailFrom = session.mailFrom;
  const recipients = [...session.rcptTo];
  resetEnvelope(session);

  if (input.overflowed || input.rawMime.byteLength > MAX_SMTP_MESSAGE_BYTES) {
    sendSmtpReply(
      socket,
      session,
      "552 5.3.4 Message size exceeds fixed maximum message size\r\n",
    );
    return;
  }
  if (authClient === null || mailFrom === null || recipients.length === 0) {
    sendSmtpReply(socket, session, "503 5.5.1 Bad sequence of commands\r\n");
    return;
  }

  const parsedMime = await parseInboundMime(input.rawMime);
  if (
    parsedMime.fromAddress === null ||
    !isSenderDomainAllowed(parsedMime.fromAddress, authClient.config)
  ) {
    sendSmtpReply(
      socket,
      session,
      "550 5.7.1 Sender domain not authorized\r\n",
    );
    return;
  }

  const settings = await ctx.getSettings();
  const now = ctx.now();
  const sinceIso = new Date(now.getTime() - TEN_MINUTES_MS).toISOString();
  if (
    ctx.store.countClientMessagesSince(authClient.clientId, sinceIso) >=
    settings.maxPerClientPerTenMinutes
  ) {
    sendSmtpReply(socket, session, "451 4.7.1 Rate limit exceeded\r\n");
    return;
  }

  const enqueued = ctx.store.enqueueMessage({
    clientId: authClient.clientId,
    protocol: "smtp",
    idempotencyKey: null,
    rfcMessageId: parsedMime.rfcMessageId,
    mailFrom,
    recipients,
    fromHeader: parsedMime.fromHeader,
    toHeader:
      parsedMime.toHeader.length > 0
        ? parsedMime.toHeader
        : recipients.join(", "),
    subject: parsedMime.subject,
    tag: parsedMime.tag,
    plainBody: parsedMime.plainBody,
    htmlBody: parsedMime.htmlBody,
    headers: parsedMime.headers,
    rawMime: input.rawMime,
    nowIso: now.toISOString(),
    retentionDays: settings.retentionDays,
  });

  ctx.metrics?.messagesIngestedTotal.inc({
    protocol: "smtp",
    client_id: authClient.clientId,
    deduplicated: "false",
  });
  ctx.onMessageQueued();
  sendSmtpReply(
    socket,
    session,
    `250 2.0.0 Ok: queued as ${enqueued.message.id}\r\n`,
  );
}

export async function dispatchSmtpCommand(
  ctx: SmtpServerContext,
  socket: Socket<SmtpSession>,
  session: SmtpSession,
  line: string,
): Promise<void> {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    sendSmtpReply(socket, session, "500 5.5.1 Empty command\r\n");
    return;
  }
  const spaceIdx = trimmed.indexOf(" ");
  const verb = (
    spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)
  ).toUpperCase();
  const arg = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1);

  switch (verb) {
    case "EHLO":
      await handleEhlo(ctx, socket, session, arg);
      return;
    case "HELO":
      handleHelo(ctx, socket, session, arg);
      return;
    case "STARTTLS":
      await handleStartTls(ctx, socket, session, arg);
      return;
    case "AUTH":
      await handleSmtpAuthCommand(ctx, socket, session, arg);
      return;
    case "MAIL":
      handleMailFrom(socket, session, arg);
      return;
    case "RCPT":
      handleRcptTo(socket, session, arg);
      return;
    case "DATA":
      handleDataStart(socket, session, arg);
      return;
    case "RSET":
      resetEnvelope(session);
      sendSmtpReply(socket, session, "250 2.0.0 Ok\r\n");
      return;
    case "NOOP":
      sendSmtpReply(socket, session, "250 2.0.0 Ok\r\n");
      return;
    case "VRFY":
      sendSmtpReply(socket, session, "252 2.5.2 Cannot VRFY user\r\n");
      return;
    case "QUIT":
      sendSmtpReply(socket, session, "221 2.0.0 Bye\r\n");
      session.closed = true;
      socket.end();
      return;
    default:
      sendSmtpReply(socket, session, "500 5.5.1 Command unrecognized\r\n");
  }
}
