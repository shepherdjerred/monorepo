import assert from "node:assert/strict";
import type { Socket } from "node:net";
import {
  AccountFrameDecoder,
  encodeAccountCommand,
  type AccountCommand,
  type AccountIdentity,
  type AccountReply,
  type AccountOperation,
  type VerificationSource,
  assertInputClock,
  assertVerificationFresh,
} from "./contract";
import type { AppInput } from "./app-input";
import { phasePolicy } from "./phases/policy";
import { submissionIntent, type SubmitIntent } from "./phases/intents";
import { PrivatePhaseFailure, type InputPhase } from "./phases/failure";

import { withOwnedAccountSocket } from "./phases/socket-owner";

type Ready = Extract<AccountReply, { kind: "ready" }>;

export class PrivateAccountSession {
  private readonly decoder: AccountFrameDecoder;
  private readonly queued: AccountReply[] = [];
  private pending:
    | { resolve: (reply: AccountReply) => void; reject: (error: Error) => void }
    | undefined;
  private failure: Error | undefined;
  private commands = 0;
  private filled = false;
  private credentialsSubmitted = false;
  private verificationFilled = false;
  private verificationSubmitted = false;
  private verificationExpiry: number | undefined;
  private vaultFilled = false;
  private connectSubmitted = false;
  private submissions = 0;
  private currentStage:
    "credentials" | "verification" | "vaults" | "connected" | "rejected" =
    "credentials";
  private connectEnabled = false;
  private completed = false;
  private ready: Ready | undefined;
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly app: AppInput;
  private readonly operation: AccountOperation;
  private readonly recordIntent: (intent: SubmitIntent) => Promise<void>;
  private readonly recorded = new Set<SubmitIntent["action"]>();
  private phase: InputPhase = "prepare";

  constructor(
    private readonly socket: Socket,
    private readonly identity: AccountIdentity,
    private readonly validateOwner: (ready: Ready) => Promise<void>,
    input: {
      app: AppInput;
      operation: AccountOperation;
      recordIntent: (intent: SubmitIntent) => Promise<void>;
    },
  ) {
    this.app = input.app;
    this.operation = input.operation;
    this.recordIntent = input.recordIntent;
    this.decoder = new AccountFrameDecoder(identity);
    this.timer = setTimeout(() => {
      this.fail("deadline");
    }, 120_000);
    socket.on("data", (chunk) => {
      try {
        if (typeof chunk === "string") {
          this.fail();
          return;
        }
        for (const reply of this.decoder.push(chunk)) {
          if (reply.kind === "rejected") {
            this.fail(reply.reason === "input" ? "protocol" : reply.reason);
            return;
          }
          if (this.pending === undefined) this.queued.push(reply);
          else {
            const pending = this.pending;
            this.pending = undefined;
            pending.resolve(reply);
          }
        }
      } catch {
        this.fail();
      }
    });
    socket.on("error", () => {
      this.fail();
    });
    socket.on("end", () => {
      if (!this.completed && this.pending !== undefined) this.fail();
    });
  }

  private fail(
    kind:
      | "deadline"
      | "ownership"
      | "form"
      | "focus"
      | "socket"
      | "protocol" = "socket",
  ) {
    this.failure ??= new PrivatePhaseFailure(kind, this.phase);
    this.pending?.reject(this.failure);
    this.pending = undefined;
    this.socket.destroy();
  }

  private receive(): Promise<AccountReply> {
    if (this.failure !== undefined) return Promise.reject(this.failure);
    const reply = this.queued.shift();
    if (reply !== undefined) return Promise.resolve(reply);
    assert.equal(
      this.pending,
      undefined,
      "Only one private input command may be pending",
    );
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
    });
  }

  async bind() {
    const reply = await this.receive();
    if (reply.kind !== "ready")
      throw new Error("Private iOS input is not an owned account form");
    this.ready = reply;
    assert.equal(reply.operation, this.operation);
    assert.ok(
      phasePolicy(this.operation).initialStages.includes(reply.stage),
      "Private input initial stage is not authorized for this phase",
    );
    assertInputClock(reply.clockUnixMilliseconds);
    this.currentStage = reply.stage;
    this.connectEnabled = reply.connectEnabled ?? false;
    await this.validateOwner(reply);
    assert.equal(
      this.app.stage,
      reply.stage,
      "Private app and owned UI disagree about their initial stage",
    );
  }

  get stage() {
    return this.currentStage;
  }
  get canConnectWithoutPassword() {
    return this.currentStage === "vaults" && this.connectEnabled;
  }

  private async exchange(command: AccountCommand) {
    const policy = phasePolicy(this.operation);
    assert.ok(
      policy.allowedRunnerKinds.includes(command.kind),
      "Private account phase forbids this command",
    );
    assert.ok(
      this.ready !== undefined &&
        !this.completed &&
        ++this.commands <= policy.runnerCommandLimit,
    );
    assert.equal(
      this.queued.length,
      0,
      "Private input returned unsolicited frames",
    );
    await this.validateOwner(this.ready);
    if (
      command.kind === "fill-verification" ||
      command.kind === "submit-verification"
    )
      assertVerificationFresh(command.expiresAtUnixMilliseconds);
    const intent = submissionIntent(this.operation, command);
    if (intent !== undefined) {
      assert.ok(
        !this.recorded.has(intent.action) &&
          policy.maximumSubmissions[intent.action] === 1,
        "A private phase cannot repeat a submission intent",
      );
      await this.recordIntent(intent);
      this.recorded.add(intent.action);
    }
    const encoded = encodeAccountCommand(command);
    try {
      await new Promise<void>((resolve, reject) => {
        this.socket.write(encoded, (error) => {
          encoded.fill(0);
          if (error === null || error === undefined) resolve();
          else
            reject(new Error("Private iOS input could not write its command"));
        });
      });
      const reply = await this.receive();
      if (!("requestID" in reply) || reply.requestID !== command.requestID)
        throw new Error("Private input reply belongs to another command");
      await this.validateOwner(this.ready);
      return reply;
    } finally {
      encoded.fill(0);
    }
  }

  async fill(credentials: { email: string; password: string }) {
    this.phase = "credentials";
    assert.ok(phasePolicy(this.operation).allowedAppKinds.includes("email"));
    assert.ok(
      this.currentStage === "credentials" &&
        !this.filled &&
        !this.credentialsSubmitted,
      "A private session cannot repeat credential entry",
    );
    await this.app.apply("clear", "credentials");
    await this.checkpoint("checkpoint-empty", "empty");
    await this.app.apply("email", "credentials", credentials.email);
    await this.checkpoint("checkpoint-email", "email");
    await this.app.apply("password", "credentials", credentials.password);
    const reply = await this.exchange({
      schemaVersion: 1,
      ...this.identity,
      requestID: crypto.randomUUID(),
      kind: "fill",
    });
    if (reply.kind !== "filled")
      throw new Error("Private iOS credential entry was not acknowledged");
    this.filled = true;
    return {
      disabledCheckpoints: reply.disabledCheckpoints,
      signInEnabled: reply.signInEnabled,
      submitActionCount: reply.submitActionCount,
    };
  }

  async submit() {
    this.phase = "credentials";
    assert.ok(
      this.operation === "auth-only" ||
        this.operation === "fixture-verification",
    );
    assert.ok(
      this.filled && !this.completed && !this.credentialsSubmitted,
      "Submission requires acknowledged credential entry",
    );
    await this.app.validate("credentials");
    const reply = await this.exchange({
      schemaVersion: 1,
      ...this.identity,
      requestID: crypto.randomUUID(),
      kind: "submit",
    });
    if (reply.kind !== "submitted")
      throw new Error("Private iOS account submission was not acknowledged");
    this.credentialsSubmitted = true;
    this.submissions += 1;
    return { submitActionCount: reply.submitActionCount };
  }

  async observe() {
    const reply = await this.exchange({
      schemaVersion: 1,
      ...this.identity,
      requestID: crypto.randomUUID(),
      kind: "observe",
    });
    if (reply.kind !== "observed")
      throw new Error("Private iOS account state was not observed");
    this.currentStage = reply.stage;
    this.connectEnabled = reply.connectEnabled ?? false;
    return { stage: reply.stage, connectEnabled: reply.connectEnabled };
  }

  async fillVerification(source: VerificationSource) {
    this.phase = "verification";
    assert.ok(
      this.operation === "auth-only" ||
        this.operation === "fixture-verification",
    );
    assert.ok(
      this.currentStage === "verification" &&
        !this.verificationFilled &&
        !this.verificationSubmitted,
    );
    const expiresAtUnixMilliseconds = await this.app.applyVerification({
      waitUntilFresh: async () => {
        await source.waitUntilFresh();
        assert.ok(this.ready !== undefined);
        await this.validateOwner(this.ready);
      },
      issue: () => source.issue(),
    });
    assertVerificationFresh(expiresAtUnixMilliseconds);
    this.verificationExpiry = expiresAtUnixMilliseconds;
    const reply = await this.exchange({
      schemaVersion: 1,
      ...this.identity,
      requestID: crypto.randomUUID(),
      kind: "fill-verification",
      expiresAtUnixMilliseconds,
    });
    if (reply.kind !== "verification-filled")
      throw new Error("Private verification entry was not acknowledged");
    this.verificationFilled = true;
  }

  async submitVerification() {
    this.phase = "verification";
    assert.equal(this.operation, "auth-only");
    assert.ok(this.verificationFilled && !this.verificationSubmitted);
    await this.app.validate("verification");
    assert.ok(this.verificationExpiry !== undefined);
    assertVerificationFresh(this.verificationExpiry);
    const reply = await this.exchange({
      schemaVersion: 1,
      ...this.identity,
      requestID: crypto.randomUUID(),
      kind: "submit-verification",
      expiresAtUnixMilliseconds: this.verificationExpiry,
    });
    if (reply.kind !== "verification-submitted")
      throw new Error("Private verification submission was not acknowledged");
    this.verificationSubmitted = true;
    this.submissions += 1;
  }

  async fillVaultPassword(vaultPassword: string) {
    this.phase = "vault-password";
    assert.equal(this.operation, "connect-only");
    assert.ok(
      this.currentStage === "vaults" &&
        !this.vaultFilled &&
        !this.connectSubmitted,
    );
    await this.app.apply("clear-vault", "vaults");
    await this.checkpoint("checkpoint-vault-empty", "vault-empty");
    await this.app.apply("vault-password", "vaults", vaultPassword);
    const reply = await this.exchange({
      schemaVersion: 1,
      ...this.identity,
      requestID: crypto.randomUUID(),
      kind: "fill-vault-password",
    });
    if (reply.kind !== "vault-password-filled")
      throw new Error("Private vault password entry was not acknowledged");
    this.vaultFilled = true;
  }

  async connect(remoteVaultID: string, profileID?: string) {
    this.phase = "connect";
    assert.equal(this.operation, "connect-only");
    assert.ok(
      this.currentStage === "vaults" &&
        (this.vaultFilled || this.connectEnabled) &&
        !this.connectSubmitted,
    );
    await this.app.validate("connect");
    await this.app.expectClose();
    const reply = await this.exchange({
      schemaVersion: 1,
      ...this.identity,
      requestID: crypto.randomUUID(),
      kind: "connect",
      remoteVaultID,
      ...(profileID === undefined ? {} : { profileID }),
    });
    if (reply.kind !== "connect-submitted")
      throw new Error("Private vault connection was not acknowledged");
    this.connectSubmitted = true;
    this.submissions += 1;
  }

  async finish() {
    this.phase = "finish";
    assert.ok(
      this.currentStage !== "rejected" &&
        phasePolicy(this.operation).finishStages.includes(this.currentStage),
      "A private phase cannot finish before its settled outcome",
    );
    await this.app.finish(
      this.currentStage === "verification"
        ? "verification"
        : this.currentStage === "vaults"
          ? "vaults"
          : "credentials",
    );
    const reply = await this.exchange({
      schemaVersion: 1,
      ...this.identity,
      requestID: crypto.randomUUID(),
      kind: "finish",
    });
    if (reply.kind !== "finished")
      throw new Error("Private iOS input did not finish without submission");
    assert.equal(
      reply.submitActionCount,
      this.submissions,
      "Private account session submitted an unexpected action",
    );
    this.completed = true;
    return { submitActionCount: reply.submitActionCount };
  }

  close() {
    clearTimeout(this.timer);
    this.socket.destroy();
  }

  private async checkpoint(
    kind: "checkpoint-empty" | "checkpoint-email" | "checkpoint-vault-empty",
    point: "empty" | "email" | "vault-empty",
  ) {
    const reply = await this.exchange({
      schemaVersion: 1,
      ...this.identity,
      requestID: crypto.randomUUID(),
      kind,
    });
    assert.ok(
      reply.kind === "checkpoint" && reply.point === point,
      "Owned UI did not acknowledge the disabled control checkpoint",
    );
  }
}

export type AccountInputClient = Pick<
  PrivateAccountSession,
  | "stage"
  | "canConnectWithoutPassword"
  | "fill"
  | "submit"
  | "observe"
  | "fillVerification"
  | "submitVerification"
  | "fillVaultPassword"
  | "connect"
  | "finish"
>;

export async function withPrivateAccountInput<T>(
  options: {
    directory: string;
    identity: AccountIdentity;
    validateOwner: (ready: Ready) => Promise<void>;
    app: AppInput;
    operation: AccountOperation;
    recordIntent: (intent: SubmitIntent) => Promise<void>;
  },
  work: (session: PrivateAccountSession) => Promise<T>,
): Promise<T> {
  return withOwnedAccountSocket(
    options.directory,
    options.identity.sessionID,
    async (socket) => {
      const session = new PrivateAccountSession(
        socket,
        options.identity,
        options.validateOwner,
        {
          app: options.app,
          operation: options.operation,
          recordIntent: options.recordIntent,
        },
      );
      try {
        await session.bind();
        return await work(session);
      } finally {
        session.close();
      }
    },
  );
}
