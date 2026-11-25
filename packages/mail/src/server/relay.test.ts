import type { Socket, TCPSocketListener } from "bun";
import { afterEach, describe, expect, test } from "vitest";
import { createMailMetrics } from "./metrics.ts";
import { synthesizeMimeMessage } from "./mime.ts";
import { RelayWorker } from "./relay.ts";
import { unstuffSmtpData } from "./smtp-protocol.ts";
import { MailStore } from "./store.ts";

type ReceivedUpstreamMail = {
  readonly authPayload: string | null;
  readonly mailFrom: string;
  readonly rcptTo: string[];
  readonly rawData: Uint8Array;
};

type MockUpstreamSession = {
  mode: "cmd" | "data";
  buffer: Buffer;
  authPayload: string | null;
  mailFrom: string;
  rcptTo: string[];
};

type MockFastmailServer = {
  readonly port: number;
  readonly received: ReceivedUpstreamMail[];
  readonly attemptsCount: () => number;
  readonly stop: () => void;
};

const CRLF_DOT_CRLF = Buffer.from("\r\n.\r\n");

function startMockFastmailServer(
  decideDataResponse: (attemptIndex: number) => string,
): MockFastmailServer {
  const received: ReceivedUpstreamMail[] = [];
  let dataAttempts = 0;

  function handleCommand(
    socket: Socket<MockUpstreamSession>,
    session: MockUpstreamSession,
    line: string,
  ): void {
    const upper = line.toUpperCase();
    if (upper.startsWith("EHLO ") || upper.startsWith("HELO ")) {
      socket.write(
        "250-mock.fastmail.local\r\n250-8BITMIME\r\n250 AUTH PLAIN LOGIN\r\n",
      );
      return;
    }
    if (upper.startsWith("AUTH PLAIN ")) {
      session.authPayload = line.slice("AUTH PLAIN ".length).trim();
      socket.write("235 2.7.0 Authentication successful\r\n");
      return;
    }
    if (upper.startsWith("MAIL FROM:")) {
      session.mailFrom = line.slice("MAIL FROM:".length).trim();
      session.rcptTo = [];
      socket.write("250 2.1.0 Ok\r\n");
      return;
    }
    if (upper.startsWith("RCPT TO:")) {
      session.rcptTo.push(line.slice("RCPT TO:".length).trim());
      socket.write("250 2.1.5 Ok\r\n");
      return;
    }
    if (upper === "DATA") {
      session.mode = "data";
      socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
      return;
    }
    if (upper === "RSET" || upper === "NOOP") {
      session.mailFrom = "";
      session.rcptTo = [];
      socket.write("250 2.0.0 Ok\r\n");
      return;
    }
    if (upper === "QUIT") {
      socket.write("221 2.0.0 Bye\r\n");
      socket.end();
      return;
    }
    socket.write("500 Unrecognized\r\n");
  }

  const listener: TCPSocketListener<MockUpstreamSession> =
    Bun.listen<MockUpstreamSession>({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(socket) {
          socket.data = {
            mode: "cmd",
            buffer: Buffer.alloc(0),
            authPayload: null,
            mailFrom: "",
            rcptTo: [],
          };
          socket.write("220 mock.fastmail.local ESMTP ready\r\n");
        },
        data(socket, chunk) {
          const s = socket.data;
          s.buffer =
            s.buffer.length === 0
              ? Buffer.from(chunk)
              : Buffer.concat([s.buffer, chunk]);

          while (s.buffer.length > 0) {
            if (s.mode === "data") {
              const endIdx = s.buffer.indexOf(CRLF_DOT_CRLF);
              if (endIdx === -1) {
                break;
              }
              const rawBody = unstuffSmtpData(s.buffer.subarray(0, endIdx + 2));
              s.buffer = Buffer.from(s.buffer.subarray(endIdx + 5));
              s.mode = "cmd";
              const idx = dataAttempts;
              dataAttempts += 1;
              const reply = decideDataResponse(idx);
              if (reply.startsWith("250")) {
                received.push({
                  authPayload: s.authPayload,
                  mailFrom: s.mailFrom,
                  rcptTo: [...s.rcptTo],
                  rawData: rawBody,
                });
              }
              s.mailFrom = "";
              s.rcptTo = [];
              socket.write(`${reply}\r\n`);
              continue;
            }

            const lf = s.buffer.indexOf(0x0a);
            if (lf === -1) {
              break;
            }
            const line = s.buffer
              .subarray(0, lf)
              .toString("utf8")
              .replace(/\r+$/u, "");
            s.buffer = Buffer.from(s.buffer.subarray(lf + 1));
            handleCommand(socket, s, line);
          }
        },
      },
    });

  return {
    port: listener.port,
    received,
    attemptsCount: () => dataAttempts,
    stop: () => {
      listener.stop(true);
    },
  };
}

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop();
    if (fn !== undefined) {
      await fn();
    }
  }
});

async function waitForStatus(
  store: MailStore,
  messageId: string,
  expected: string,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const detail = store.getMessageDetail(messageId);
    if (detail?.status === expected) {
      return;
    }
    await Bun.sleep(20);
  }
  throw new Error(
    `Timed out waiting for message ${messageId} to reach '${expected}' (current: ${String(store.getMessageDetail(messageId)?.status)})`,
  );
}

async function enqueueTestMessage(store: MailStore, subject: string) {
  const synthesized = await synthesizeMimeMessage({
    to: ["jerred@sjer.red"],
    from: "Hub Alerts <alerts@sjer.red>",
    subject,
    plainBody: `Body for ${subject}`,
  });
  return {
    synthesized,
    enqueued: store.enqueueMessage({
      clientId: "alert-dashboard",
      protocol: "http",
      rfcMessageId: synthesized.rfcMessageId,
      mailFrom: synthesized.mailFrom,
      recipients: synthesized.recipients,
      fromHeader: synthesized.fromHeader,
      toHeader: synthesized.toHeader,
      subject: synthesized.subject,
      plainBody: synthesized.plainBody,
      htmlBody: synthesized.htmlBody,
      headers: synthesized.headers,
      rawMime: synthesized.rawMime,
    }),
  };
}

function startTestRelayHarness(
  dataResponse: (attemptIndex: number) => string,
  options?: {
    readonly isRelayEnabled?: () => Promise<boolean>;
    readonly metrics?: ReturnType<typeof createMailMetrics>;
  },
) {
  const upstream = startMockFastmailServer(dataResponse);
  const store = MailStore.open(":memory:");
  const relay = new RelayWorker({
    store,
    fastmailHost: "127.0.0.1",
    fastmailPort: upstream.port,
    fastmailUsername: "broker@sjer.red",
    fastmailPassword: "fastmail-app-password",
    fastmailRequireTls: false,
    isRelayEnabled: options?.isRelayEnabled ?? (async () => true),
    ...(options?.metrics === undefined ? {} : { metrics: options.metrics }),
  });
  cleanups.push(async () => {
    await relay.stop();
    upstream.stop();
    store.close();
  });
  relay.start();
  return { upstream, store, relay };
}

describe("RelayWorker against local ESMTP mock Fastmail", () => {
  test("delivers 250 OK with byte-identical MIME and Fastmail SMTP AUTH", async () => {
    const metrics = createMailMetrics();
    const { upstream, store, relay } = startTestRelayHarness(
      () => "250 2.0.0 Ok: queued as fastmail-1",
      { metrics },
    );
    const { synthesized, enqueued } = await enqueueTestMessage(
      store,
      "Relay 250 success",
    );
    relay.notify();

    await waitForStatus(store, enqueued.message.id, "sent");
    const detail = store.getMessageDetail(enqueued.message.id);
    expect(detail?.status).toBe("sent");
    expect(detail?.sentAt).not.toBeNull();
    expect(detail?.attemptCount).toBe(1);
    expect(detail?.lastSmtpCode).toBe(250);
    expect(detail?.attempts[0]?.outcome).toBe("sent");

    expect(upstream.received).toHaveLength(1);
    expect(upstream.received[0]?.mailFrom).toContain("alerts@sjer.red");
    expect(
      Buffer.from(upstream.received[0]?.rawData ?? new Uint8Array()).toString(
        "utf8",
      ),
    ).toBe(Buffer.from(synthesized.rawMime).toString("utf8"));
  });

  test("backs off on 451 transient SMTP failure and succeeds on subsequent retry", async () => {
    const { upstream, store, relay } = startTestRelayHarness((attemptIdx) =>
      attemptIdx === 0
        ? "451 4.7.1 Temporary rate limit, retry in 1 seconds"
        : "250 2.0.0 Ok: accepted on retry",
    );
    const { enqueued } = await enqueueTestMessage(store, "Transient 451 retry");
    relay.notify();

    await waitForStatus(store, enqueued.message.id, "sent", 5000);
    const detail = store.getMessageDetail(enqueued.message.id);
    expect(detail?.attemptCount).toBe(2);
    expect(detail?.attempts.map((a) => a.outcome)).toEqual([
      "transient_error",
      "sent",
    ]);
    expect(detail?.attempts[0]?.smtpCode).toBe(451);
    expect(detail?.attempts[1]?.smtpCode).toBe(250);
    expect(upstream.attemptsCount()).toBe(2);
  });

  test("marks 550 permanent SMTP failure as failed without retrying", async () => {
    const { upstream, store, relay } = startTestRelayHarness(
      () => "550 5.1.1 Mailbox does not exist",
    );
    const { enqueued } = await enqueueTestMessage(store, "Permanent 550");
    relay.notify();

    await waitForStatus(store, enqueued.message.id, "failed");
    await Bun.sleep(100);

    const detail = store.getMessageDetail(enqueued.message.id);
    expect(detail?.status).toBe("failed");
    expect(detail?.failedAt).not.toBeNull();
    expect(detail?.attemptCount).toBe(1);
    expect(detail?.lastSmtpCode).toBe(550);
    expect(detail?.attempts[0]?.outcome).toBe("permanent_error");
    expect(store.nextDueTimestamp()).toBeNull();
    expect(upstream.attemptsCount()).toBe(1);
  });

  test("pauses draining when mail-relay-enabled is false and resumes when re-enabled", async () => {
    let relayEnabled = false;
    const { upstream, store, relay } = startTestRelayHarness(
      () => "250 2.0.0 Ok",
      { isRelayEnabled: async () => relayEnabled },
    );
    const { enqueued } = await enqueueTestMessage(store, "Paused relay check");
    relay.notify();
    await Bun.sleep(120);

    expect(store.getMessageDetail(enqueued.message.id)?.status).toBe("queued");
    expect(upstream.attemptsCount()).toBe(0);

    relayEnabled = true;
    relay.notify();
    await waitForStatus(store, enqueued.message.id, "sent");
    expect(upstream.attemptsCount()).toBe(1);
  });
});
