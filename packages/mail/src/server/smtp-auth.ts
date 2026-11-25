import type { Socket } from "bun";
import { authenticateSmtpClient } from "./auth.ts";
import {
  decodeAuthPlainCredentials,
  decodeBase64Utf8,
} from "./smtp-protocol.ts";
import {
  sendSmtpReply,
  type SmtpServerContext,
  type SmtpSession,
} from "./smtp-session.ts";

export function completePlainAuth(
  ctx: SmtpServerContext,
  socket: Socket<SmtpSession>,
  session: SmtpSession,
  encoded: string,
): void {
  session.mode = "command";
  if (encoded.trim() === "*") {
    sendSmtpReply(socket, session, "501 5.7.0 Authentication aborted\r\n");
    return;
  }
  const creds = decodeAuthPlainCredentials(encoded);
  const matched =
    creds === null
      ? null
      : authenticateSmtpClient(creds.username, creds.password, ctx.clients);
  if (matched === null) {
    sendSmtpReply(
      socket,
      session,
      "535 5.7.8 Authentication credentials invalid\r\n",
    );
    return;
  }
  session.authenticatedClient = matched;
  sendSmtpReply(socket, session, "235 2.7.0 Authentication successful\r\n");
}

export function handleLoginStep(
  ctx: SmtpServerContext,
  socket: Socket<SmtpSession>,
  session: SmtpSession,
  line: string,
): void {
  if (line.trim() === "*") {
    session.mode = "command";
    session.pendingLoginUsername = null;
    sendSmtpReply(socket, session, "501 5.7.0 Authentication aborted\r\n");
    return;
  }
  if (session.mode === "auth_login_user") {
    const username = decodeBase64Utf8(line);
    if (username === null) {
      session.mode = "command";
      sendSmtpReply(
        socket,
        session,
        "535 5.7.8 Authentication credentials invalid\r\n",
      );
      return;
    }
    session.pendingLoginUsername = username;
    session.mode = "auth_login_pass";
    sendSmtpReply(socket, session, "334 UGFzc3dvcmQ6\r\n");
    return;
  }

  const password = decodeBase64Utf8(line);
  const username = session.pendingLoginUsername;
  session.pendingLoginUsername = null;
  session.mode = "command";
  const matched =
    username === null || password === null
      ? null
      : authenticateSmtpClient(username, password, ctx.clients);
  if (matched === null) {
    sendSmtpReply(
      socket,
      session,
      "535 5.7.8 Authentication credentials invalid\r\n",
    );
    return;
  }
  session.authenticatedClient = matched;
  sendSmtpReply(socket, session, "235 2.7.0 Authentication successful\r\n");
}

function dispatchAuthMechanism(
  ctx: SmtpServerContext,
  socket: Socket<SmtpSession>,
  session: SmtpSession,
  parsed: { readonly mechanism: string; readonly initialResponse: string },
): void {
  if (parsed.mechanism === "PLAIN") {
    if (parsed.initialResponse.length === 0) {
      session.mode = "auth_plain";
      sendSmtpReply(socket, session, "334 \r\n");
      return;
    }
    completePlainAuth(ctx, socket, session, parsed.initialResponse);
    return;
  }

  if (parsed.mechanism === "LOGIN") {
    if (parsed.initialResponse.length === 0) {
      session.mode = "auth_login_user";
      sendSmtpReply(socket, session, "334 VXNlcm5hbWU6\r\n");
      return;
    }
    const username = decodeBase64Utf8(parsed.initialResponse);
    if (username === null) {
      sendSmtpReply(
        socket,
        session,
        "535 5.7.8 Authentication credentials invalid\r\n",
      );
      return;
    }
    session.pendingLoginUsername = username;
    session.mode = "auth_login_pass";
    sendSmtpReply(socket, session, "334 UGFzc3dvcmQ6\r\n");
    return;
  }

  sendSmtpReply(
    socket,
    session,
    "504 5.5.4 Unrecognized authentication type\r\n",
  );
}

export async function handleSmtpAuthCommand(
  ctx: SmtpServerContext,
  socket: Socket<SmtpSession>,
  session: SmtpSession,
  arg: string,
): Promise<void> {
  if (session.helo === null) {
    sendSmtpReply(socket, session, "503 5.5.1 Send EHLO/HELO first\r\n");
    return;
  }
  if (session.authenticatedClient !== null) {
    sendSmtpReply(socket, session, "503 5.5.1 Already authenticated\r\n");
    return;
  }
  const settings = await ctx.getSettings();
  if (
    ctx.tlsLoader !== undefined &&
    !settings.allowCleartextSmtpAuth &&
    !session.isTls
  ) {
    sendSmtpReply(
      socket,
      session,
      "538 5.7.11 Encryption required for requested authentication mechanism\r\n",
    );
    return;
  }

  const trimmed = arg.trim();
  if (trimmed.length === 0) {
    sendSmtpReply(socket, session, "501 5.5.4 Syntax: AUTH mechanism\r\n");
    return;
  }
  const spaceIdx = trimmed.indexOf(" ");
  const mechanism = (
    spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)
  ).toUpperCase();
  const initialResponse =
    spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();
  dispatchAuthMechanism(ctx, socket, session, { mechanism, initialResponse });
}
