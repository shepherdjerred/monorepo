import { Socket } from "node:net";
import { expect, test } from "vitest";
import { PrivateAccountSession } from "./connection";
import { boundaryCheck } from "./contract";
import type { AccountOperation } from "./contract";
import type { AppInput } from "./app-input";
import { z } from "zod";

const identity = {
  sessionID: "12345678-1234-4234-9234-123456789abc",
  runID: "22345678-1234-4234-9234-123456789abc",
  deviceID: "32345678-1234-4234-9234-123456789abc",
};
type Callback = (error?: Error | null) => void;

test("fixture verification permits one synthetic initial submit and never code submit/connect", async () => {
  const { session, wire } = fixture(true, false, "fixture-verification");
  try {
    await session.bind();
    await session.fill({
      email: "synthetic@example.invalid",
      password: "synthetic-only-password",
    });
    await session.submit();
    await session.observe();
    await session.fillVerification({
      waitUntilFresh: () => Promise.resolve(),
      issue: () => ({
        code: "739251",
        expiresAtUnixMilliseconds: Date.now() + 30_000,
      }),
    });
    await expect(session.submitVerification()).rejects.toThrow();
    await expect(session.connect("never-remote")).rejects.toThrow();
    const finished = await session.finish();
    expect(finished.submitActionCount).toBe(1);
    expect(wire.commands).toHaveLength(7);
    expect(wire.commands).not.toContain("submit-verification");
    expect(wire.commands).not.toContain("connect");
  } finally {
    session.close();
  }
  const probe = fixture(false, false, "probe");
  try {
    await probe.session.bind();
    await probe.session.fill({
      email: "synthetic@example.invalid",
      password: "synthetic-only-password",
    });
    await expect(probe.session.submit()).rejects.toThrow();
    expect(probe.wire.commands).not.toContain("submit");
  } finally {
    probe.session.close();
  }
});
class RunnerWire extends Socket {
  readonly frames: string[] = [];
  readonly commands: string[] = [];
  private observed = 0;
  private submissions = 0;
  constructor(
    private readonly mfa: boolean,
    private readonly encrypted: boolean,
    private readonly operation: AccountOperation,
  ) {
    super();
  }
  override write(chunk: Uint8Array | string, callback?: Callback): boolean;
  override write(
    chunk: string,
    encoding?: BufferEncoding,
    callback?: Callback,
  ): boolean;
  override write(
    chunk: Uint8Array | string,
    encodingOrCallback?: BufferEncoding | Callback,
    callback?: Callback,
  ): boolean {
    const frame = Buffer.from(chunk).toString("utf8");
    this.frames.push(frame);
    const value: unknown = JSON.parse(frame);
    boundaryCheck("command", value);
    const command = z
      .object({ kind: z.string(), requestID: z.string() })
      .parse(value);
    this.commands.push(command.kind);
    const envelope = {
      schemaVersion: 1,
      ...identity,
      requestID: command.requestID,
    };
    const reply = this.reply(command.kind, envelope);
    const done =
      typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
    queueMicrotask(() => {
      done?.();
      this.emit("data", Buffer.from(JSON.stringify(reply) + "\n"));
    });
    return true;
  }
  private reply(kind: string, envelope: Record<string, unknown>) {
    let reply: Record<string, unknown>;
    switch (kind) {
      case "checkpoint-empty":
      case "checkpoint-email":
        reply = {
          ...envelope,
          kind: "checkpoint",
          point: kind === "checkpoint-empty" ? "empty" : "email",
          signInEnabled: false,
          submitActionCount: 0,
        };
        break;
      case "checkpoint-vault-empty":
        reply = {
          ...envelope,
          kind: "checkpoint",
          point: "vault-empty",
          connectEnabled: false,
          submitActionCount: 0,
        };
        break;
      case "fill":
        reply = {
          ...envelope,
          kind: "filled",
          disabledCheckpoints: 2,
          signInEnabled: true,
          submitActionCount: 0,
        };
        break;
      case "fill-verification":
        reply = {
          ...envelope,
          kind: "verification-filled",
          signInEnabled: true,
          submitActionCount: 0,
        };
        break;
      case "fill-vault-password":
        reply = {
          ...envelope,
          kind: "vault-password-filled",
          disabledCheckpoints: 1,
          connectEnabled: true,
          submitActionCount: 0,
        };
        break;
      case "submit":
      case "submit-verification":
      case "connect":
        this.submissions += 1;
        reply = {
          ...envelope,
          kind:
            kind === "submit"
              ? "submitted"
              : kind === "connect"
                ? "connect-submitted"
                : "verification-submitted",
          submitActionCount: 1,
        };
        break;
      case "observe": {
        const stage = this.observeStage();
        reply = {
          ...envelope,
          kind: "observed",
          stage,
          busy: false,
          ...(stage === "vaults" ? { connectEnabled: !this.encrypted } : {}),
        };
        break;
      }
      case "finish":
        reply = {
          ...envelope,
          kind: "finished",
          submitActionCount: this.submissions,
        };
        break;
      default:
        throw new Error("Unexpected control fixture");
    }
    return reply;
  }
  private observeStage() {
    this.observed += 1;
    if (this.mfa && this.observed === 1) return "verification";
    if (this.observed === (this.mfa ? 2 : 1)) return "vaults";
    return "connected";
  }
  ready() {
    this.emit(
      "data",
      Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          ...identity,
          kind: "ready",
          runnerPID: 501,
          operation: this.operation,
          clockUnixMilliseconds: Date.now(),
          stage: "credentials",
          signInEnabled: false,
        }) + "\n",
      ),
    );
  }
}
function fixture(
  mfa = true,
  encrypted = true,
  operation: AccountOperation = "credentials",
) {
  const wire = new RunnerWire(mfa, encrypted, operation),
    values: { action: string; value?: string }[] = [];
  let closingExpected = false;
  const app: AppInput = {
    stage: "credentials",
    apply: async (action, _stage, value) => {
      values.push({ action, ...(value === undefined ? {} : { value }) });
    },
    applyVerification: async (source) => {
      await source.waitUntilFresh();
      const value = source.issue();
      values.push({ action: "verification", value: value.code });
      return value.expiresAtUnixMilliseconds;
    },
    validate: async () => {
      expect(closingExpected).toBe(false);
    },
    finish: async () => {
      closingExpected = true;
    },
    expectClose: async () => {
      closingExpected = true;
    },
  };
  const session = new PrivateAccountSession(
    wire,
    identity,
    async () => {
      expect(wire.destroyed).toBe(false);
    },
    { app, operation },
  );
  wire.ready();
  return { wire, values, app, session };
}

test.each([
  [true, true, 13],
  [false, true, 10],
  [true, false, 11],
  [false, false, 8],
] as const)(
  "normal MFA%s/encryption%s flow has exactly%s control-only commands",
  async (mfa, encrypted, count) => {
    const { session, wire, values } = fixture(mfa, encrypted);
    try {
      await session.bind();
      await session.fill({
        email: "synthetic@example.invalid",
        password: "synthetic-only-password",
      });
      await session.submit();
      await session.observe();
      if (mfa) {
        await session.fillVerification({
          waitUntilFresh: () => Promise.resolve(),
          issue: () => ({
            code: "123456",
            expiresAtUnixMilliseconds: Date.now() + 30_000,
          }),
        });
        await session.submitVerification();
        await session.observe();
      }
      if (encrypted) await session.fillVaultPassword("synthetic-vault-only");
      await session.connect("owned-remote");
      await session.observe();
      await session.finish();
      expect(wire.frames).toHaveLength(count);
      const raw = wire.frames.join("");
      for (const forbidden of [
        "synthetic@example.invalid",
        "synthetic-only-password",
        "synthetic-vault-only",
        '"code"',
        '"email"',
        '"password"',
        '"vaultPassword"',
      ])
        expect(raw).not.toContain(forbidden);
      expect(values.slice(0, 3).map(({ action }) => action)).toEqual([
        "clear",
        "email",
        "password",
      ]);
      if (mfa)
        expect(values).toContainEqual({
          action: "verification",
          value: "123456",
        });
      if (encrypted)
        expect(values).toContainEqual({
          action: "vault-password",
          value: "synthetic-vault-only",
        });
    } finally {
      session.close();
    }
  },
);

test("private input loss and duplicate operations cannot cause an automatic submit", async () => {
  const { session, wire, app } = fixture();
  try {
    await session.bind();
    await expect(session.submit()).rejects.toThrow();
    app.apply = async () => {
      throw new Error("mounted form epoch expired");
    };
    await expect(
      session.fill({
        email: "synthetic@example.invalid",
        password: "synthetic-only-password",
      }),
    ).rejects.toThrow("epoch expired");
    expect(wire.frames).toEqual([]);
  } finally {
    session.close();
  }
  const normal = fixture();
  try {
    await normal.session.bind();
    await normal.session.fill({
      email: "synthetic@example.invalid",
      password: "synthetic-only-password",
    });
    await expect(
      normal.session.fill({
        email: "synthetic@example.invalid",
        password: "synthetic-only-password",
      }),
    ).rejects.toThrow("repeat credential");
    expect(normal.wire.frames).toHaveLength(3);
  } finally {
    normal.session.close();
  }
});

test("normal Connect waits for verified private transport closure and never taps after closure failure", async () => {
  const { session, wire, app } = fixture(false, false);
  try {
    await session.bind();
    await session.fill({
      email: "synthetic@example.invalid",
      password: "synthetic-only-password",
    });
    await session.submit();
    await session.observe();
    let release: (() => void) | undefined;
    app.expectClose = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    const connected = session.connect("owned-remote");
    await new Promise<void>((resolve) => {
      queueMicrotask(resolve);
    });
    expect(wire.commands).not.toContain("connect");
    expect(release).toBeDefined();
    release?.();
    await connected;
    expect(wire.commands).toContain("connect");
  } finally {
    session.close();
  }
  const failed = fixture(false, false);
  try {
    await failed.session.bind();
    await failed.session.fill({
      email: "synthetic@example.invalid",
      password: "synthetic-only-password",
    });
    await failed.session.submit();
    await failed.session.observe();
    failed.app.expectClose = async () => {
      throw new Error("private closure rejected");
    };
    await expect(failed.session.connect("owned-remote")).rejects.toThrow(
      "closure rejected",
    );
    expect(failed.wire.commands).not.toContain("connect");
  } finally {
    failed.session.close();
  }
});
