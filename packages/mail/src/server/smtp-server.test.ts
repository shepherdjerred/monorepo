import { X509Certificate } from "node:crypto";
import { mkdtemp, rm, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { MailClientsMap } from "./auth.ts";
import { DEFAULT_MAIL_SETTINGS, type MailSettings } from "./config.ts";
import { startSmtpServer, type RunningSmtpServer } from "./smtp-server.ts";
import { MailStore } from "./store.ts";
import { TlsCertificateLoader } from "./tls-loader.ts";

const tempDirs: string[] = [];
const activeServers: RunningSmtpServer[] = [];
const activeStores: MailStore[] = [];

afterEach(async () => {
  while (activeServers.length > 0) {
    activeServers.pop()?.stop(true);
  }
  while (activeStores.length > 0) {
    activeStores.pop()?.close();
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

const TEST_CLIENTS: MailClientsMap = {
  "storm-forum-prod": {
    smtpUsername: "storm-forum",
    smtpPassword: "super-secret-smtp-password",
    allowedFromDomains: ["sjer.red"],
  },
};

function ignoreQueuedSignal(): void {
  // Callback placeholder for tests that inspect MailStore directly
}

async function generateSelfSignedCert(options: {
  readonly certPath: string;
  readonly keyPath: string;
  readonly commonName: string;
  readonly days: number;
}): Promise<void> {
  const proc = Bun.spawn(
    [
      "openssl",
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      options.keyPath,
      "-out",
      options.certPath,
      "-days",
      String(options.days),
      "-subj",
      `/CN=${options.commonName}`,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [stderr, exitCode] = await Promise.all([
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`openssl req failed (${String(exitCode)}): ${stderr}`);
  }
}

async function runOpensslStartTlsSession(
  port: number,
  commandsAfterTls: string,
  extraArgs: readonly string[] = [],
): Promise<{
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}> {
  const proc = Bun.spawn(
    [
      "openssl",
      "s_client",
      "-starttls",
      "smtp",
      "-connect",
      `127.0.0.1:${String(port)}`,
      ...extraArgs,
    ],
    {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  await proc.stdin.write(commandsAfterTls);
  await proc.stdin.end();
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

function encodeAuthPlain(username: string, password: string): string {
  return Buffer.from(`\0${username}\0${password}`, "utf8").toString("base64");
}

describe("SMTP server STARTTLS, AUTH PLAIN/LOGIN, and dot-unstuffing", () => {
  test("upgrades via openssl s_client -starttls smtp, authenticates PLAIN and LOGIN, and unstuffs DATA", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "mail-smtp-tls-"));
    tempDirs.push(dir);
    const certPath = path.join(dir, "tls.crt");
    const keyPath = path.join(dir, "tls.key");
    await generateSelfSignedCert({
      certPath,
      keyPath,
      commonName: "mail.sjer.red",
      days: 14,
    });

    const store = MailStore.open(":memory:");
    activeStores.push(store);
    const tlsLoader = new TlsCertificateLoader({ certPath, keyPath });
    let queuedCount = 0;

    const server = startSmtpServer({
      hostname: "127.0.0.1",
      port: 0,
      smtpHostname: "mail.sjer.red",
      store,
      clients: TEST_CLIENTS,
      tlsLoader,
      getSettings: () => Promise.resolve(DEFAULT_MAIL_SETTINGS),
      onMessageQueued: () => {
        queuedCount += 1;
      },
    });
    activeServers.push(server);

    const plainCreds = encodeAuthPlain(
      "storm-forum",
      "super-secret-smtp-password",
    );
    const smtpScript = [
      "EHLO forum.sjer.red",
      `AUTH PLAIN ${plainCreds}`,
      "MAIL FROM:<noreply@sjer.red>",
      "RCPT TO:<player@example.com>",
      "DATA",
      "From: Storm Forum <noreply@sjer.red>",
      "To: player@example.com",
      "Subject: Welcome to The Storm",
      "Message-ID: <forum-welcome-1@sjer.red>",
      "",
      "..leading-dot line",
      "...double-dot line",
      "normal line",
      ".",
      "QUIT",
      "",
    ].join("\r\n");

    const session1 = await runOpensslStartTlsSession(server.port, smtpScript, [
      "-quiet",
    ]);
    expect(session1.exitCode).toBe(0);
    expect(session1.stdout).toContain("250 AUTH PLAIN LOGIN");
    expect(session1.stdout).toContain("235 2.7.0 Authentication successful");
    expect(session1.stdout).toContain("250 2.0.0 Ok: queued as ");
    expect(queuedCount).toBe(1);

    const userB64 = Buffer.from("storm-forum", "utf8").toString("base64");
    const passB64 = Buffer.from("super-secret-smtp-password", "utf8").toString(
      "base64",
    );
    const loginScript = [
      "EHLO forum.sjer.red",
      "AUTH LOGIN",
      userB64,
      passB64,
      "MAIL FROM:<noreply@sjer.red>",
      "RCPT TO:<admin@example.com>",
      "DATA",
      "From: Storm Forum <noreply@sjer.red>",
      "To: admin@example.com",
      "Subject: Login Auth Check",
      "",
      "Hello via AUTH LOGIN",
      ".",
      "QUIT",
      "",
    ].join("\r\n");

    const session2 = await runOpensslStartTlsSession(server.port, loginScript, [
      "-quiet",
    ]);
    expect(session2.exitCode).toBe(0);
    expect(session2.stdout).toContain("334 VXNlcm5hbWU6");
    expect(session2.stdout).toContain("334 UGFzc3dvcmQ6");
    expect(session2.stdout).toContain("235 2.7.0 Authentication successful");
    expect(queuedCount).toBe(2);

    const listed = store.listMessages();
    expect(listed.total).toBe(2);
    const welcomeSummary = listed.items.find(
      (m) => m.subject === "Welcome to The Storm",
    );
    expect(welcomeSummary).toBeDefined();
    const detail = store.getMessageDetail(welcomeSummary?.id ?? "");
    expect(detail?.plainBody).toContain(".leading-dot line");
    expect(detail?.plainBody).toContain("..double-dot line");
    expect(detail?.plainBody).not.toContain("..leading-dot line");
  });

  test("hot-reloads rotated TLS certificates from disk without restarting server", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "mail-smtp-rotate-"));
    tempDirs.push(dir);
    const certPath = path.join(dir, "tls.crt");
    const keyPath = path.join(dir, "tls.key");
    await generateSelfSignedCert({
      certPath,
      keyPath,
      commonName: "leaf-v1.mail.sjer.red",
      days: 7,
    });

    const store = MailStore.open(":memory:");
    activeStores.push(store);
    const tlsLoader = new TlsCertificateLoader({ certPath, keyPath });
    const server = startSmtpServer({
      hostname: "127.0.0.1",
      port: 0,
      smtpHostname: "mail.sjer.red",
      store,
      clients: TEST_CLIENTS,
      tlsLoader,
      getSettings: () => Promise.resolve(DEFAULT_MAIL_SETTINGS),
      onMessageQueued: ignoreQueuedSignal,
    });
    activeServers.push(server);

    const probe1 = await runOpensslStartTlsSession(
      server.port,
      "EHLO probe.local\r\nQUIT\r\n",
      ["-showcerts"],
    );
    const pemMatch1 =
      /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/u.exec(
        probe1.stdout,
      );
    expect(pemMatch1?.[0]).toBeDefined();
    const cert1 = new X509Certificate(pemMatch1?.[0] ?? "");
    expect(cert1.subject).toContain("leaf-v1.mail.sjer.red");

    await generateSelfSignedCert({
      certPath,
      keyPath,
      commonName: "leaf-v2-rotated.mail.sjer.red",
      days: 60,
    });
    const futureTime = new Date(Date.now() + 5000);
    await utimes(certPath, futureTime, futureTime);
    await utimes(keyPath, futureTime, futureTime);

    const probe2 = await runOpensslStartTlsSession(
      server.port,
      "EHLO probe.local\r\nQUIT\r\n",
      ["-showcerts"],
    );
    const pemMatch2 =
      /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/u.exec(
        probe2.stdout,
      );
    expect(pemMatch2?.[0]).toBeDefined();
    const cert2 = new X509Certificate(pemMatch2?.[0] ?? "");
    expect(cert2.subject).toContain("leaf-v2-rotated.mail.sjer.red");
    expect(cert2.serialNumber).not.toBe(cert1.serialNumber);
  });
});

function hasCompleteSmtpReply(unread: string): boolean {
  const lines = unread.split("\r\n");
  // Must end with CRLF so the final reply line is complete
  if (lines.at(-1) !== "") {
    return false;
  }
  const lastComplete = lines.at(-2) ?? "";
  return /^\d{3} /u.test(lastComplete);
}

async function runRawTcpTranscript(
  port: number,
  steps: readonly string[],
  fragmentBytes?: number,
): Promise<string> {
  const allTranscript: string[] = [];
  let unread = "";
  let notifyData: (() => void) | null = null;

  const socket = await Bun.connect({
    hostname: "127.0.0.1",
    port,
    socket: {
      data(_sock, data) {
        const text = data.toString("utf8");
        allTranscript.push(text);
        unread += text;
        notifyData?.();
      },
      close() {
        notifyData?.();
      },
      error() {
        notifyData?.();
      },
    },
  });

  async function waitForReply(): Promise<void> {
    const deadline = Date.now() + 3000;
    while (!hasCompleteSmtpReply(unread) && Date.now() < deadline) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 50);
        notifyData = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
    unread = "";
  }

  try {
    // Wait for 220 greeting
    await waitForReply();

    for (const step of steps) {
      if (fragmentBytes === undefined) {
        socket.write(step);
      } else {
        const bytes = Buffer.from(step, "utf8");
        for (let offset = 0; offset < bytes.length; offset += fragmentBytes) {
          socket.write(bytes.subarray(offset, offset + fragmentBytes));
          await Bun.sleep(1);
        }
      }
      await waitForReply();
    }
  } finally {
    socket.end();
  }

  return allTranscript.join("");
}

describe("SMTP security policies and TCP packet fragmentation", () => {
  test("rejects cleartext AUTH when TLS is required and rejects unauthorized sender domains with 550", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "mail-smtp-sec-"));
    tempDirs.push(dir);
    const certPath = path.join(dir, "tls.crt");
    const keyPath = path.join(dir, "tls.key");
    await generateSelfSignedCert({
      certPath,
      keyPath,
      commonName: "mail.sjer.red",
      days: 7,
    });

    const store = MailStore.open(":memory:");
    activeStores.push(store);
    const tlsLoader = new TlsCertificateLoader({ certPath, keyPath });
    let settings: MailSettings = DEFAULT_MAIL_SETTINGS;

    const server = startSmtpServer({
      hostname: "127.0.0.1",
      port: 0,
      smtpHostname: "mail.sjer.red",
      store,
      clients: TEST_CLIENTS,
      tlsLoader,
      getSettings: () => Promise.resolve(settings),
      onMessageQueued: ignoreQueuedSignal,
    });
    activeServers.push(server);

    const creds = encodeAuthPlain("storm-forum", "super-secret-smtp-password");
    const cleartextTranscript = await runRawTcpTranscript(server.port, [
      "EHLO internal.local\r\n",
      `AUTH PLAIN ${creds}\r\n`,
      "MAIL FROM:<noreply@sjer.red>\r\n",
      "QUIT\r\n",
    ]);
    expect(cleartextTranscript).not.toContain("250 AUTH PLAIN LOGIN");
    expect(cleartextTranscript).toContain(
      "538 5.7.11 Encryption required for requested authentication mechanism",
    );
    expect(cleartextTranscript).toContain("530 5.7.0 Authentication required");

    settings = { ...DEFAULT_MAIL_SETTINGS, allowCleartextSmtpAuth: true };
    const domainTranscript = await runRawTcpTranscript(server.port, [
      "EHLO internal.local\r\n",
      `AUTH PLAIN ${creds}\r\n`,
      "MAIL FROM:<attacker@evil.example>\r\n",
      "MAIL FROM:<noreply@sjer.red>\r\n",
      "RCPT TO:<ops@sjer.red>\r\n",
      "DATA\r\n",
      "From: Spoofed <attacker@evil.example>\r\nTo: ops@sjer.red\r\nSubject: Spoof\r\n\r\nhi\r\n.\r\n",
      "QUIT\r\n",
    ]);
    const occurrences550 = domainTranscript.match(
      /550 5\.7\.1 Sender domain not authorized/gu,
    );
    expect(occurrences550).toHaveLength(2);
    expect(store.listMessages().total).toBe(0);
  });

  test("reassembles 2-byte fragmented TCP chunks across command and DATA boundaries", async () => {
    const store = MailStore.open(":memory:");
    activeStores.push(store);
    const server = startSmtpServer({
      hostname: "127.0.0.1",
      port: 0,
      smtpHostname: "mail.sjer.red",
      store,
      clients: TEST_CLIENTS,
      getSettings: () => Promise.resolve(DEFAULT_MAIL_SETTINGS),
      onMessageQueued: ignoreQueuedSignal,
    });
    activeServers.push(server);

    const creds = encodeAuthPlain("storm-forum", "super-secret-smtp-password");
    const transcript = await runRawTcpTranscript(
      server.port,
      [
        "EHLO frag.local\r\n",
        "AUTH PLAIN\r\n",
        `${creds}\r\n`,
        "MAIL FROM:<noreply@sjer.red>\r\n",
        "RCPT TO:<ops@sjer.red>\r\n",
        "DATA\r\n",
        "From: Frag <noreply@sjer.red>\r\nTo: ops@sjer.red\r\nSubject: Fragmented\r\n\r\n..dot-line\r\nChunked body!\r\n.\r\n",
        "QUIT\r\n",
      ],
      2,
    );

    expect(transcript).toContain("250 2.0.0 Ok: queued as ");
    const messages = store.listMessages();
    expect(messages.total).toBe(1);
    const detail = store.getMessageDetail(messages.items[0]?.id ?? "");
    expect(detail?.subject).toBe("Fragmented");
    expect(detail?.plainBody).toContain(".dot-line");
    expect(detail?.plainBody).toContain("Chunked body!");
  });
});
