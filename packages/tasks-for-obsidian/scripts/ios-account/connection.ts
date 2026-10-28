import assert from "node:assert/strict";
import { lstat, realpath } from "node:fs/promises";
import { createConnection, type Socket } from "node:net";
import path from "node:path";
import {
  AccountFrameDecoder,
  encodeAccountCommand,
  type AccountCommand,
  type AccountIdentity,
  type AccountReply,
} from "./contract";
import type { AppInput } from "./app-input";

type Ready = Extract<AccountReply, { kind: "ready" }>;
let active = false;

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

  constructor(
    private readonly socket: Socket,
    private readonly identity: AccountIdentity,
    private readonly validateOwner: (ready: Ready) => Promise<void>,
    private readonly app: AppInput,
  ) {
    this.decoder = new AccountFrameDecoder(identity);
    this.timer = setTimeout(() => {
      this.fail();
    }, 120_000);
    socket.on("data", (chunk) => {
      try {
        if (typeof chunk === "string") {
          this.fail();
          return;
        }
        for (const reply of this.decoder.push(chunk)) {
          if (reply.kind === "rejected") {
            this.fail();
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

  private fail() {
    this.failure = new Error(
      "Private iOS account input stopped; submission outcome may be unknown",
    );
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
    assert.ok(
      this.ready !== undefined && !this.completed && ++this.commands <= 13,
    );
    assert.equal(
      this.queued.length,
      0,
      "Private input returned unsolicited frames",
    );
    await this.validateOwner(this.ready);
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
    assert.ok(
      this.filled && !this.completed && !this.credentialsSubmitted,
      "Submission requires acknowledged credential entry",
    );
    await this.app.validate();
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

  async fillVerification(code: string) {
    assert.ok(
      this.currentStage === "verification" &&
        !this.verificationFilled &&
        !this.verificationSubmitted,
    );
    await this.app.apply("verification", "verification", code);
    const reply = await this.exchange({
      schemaVersion: 1,
      ...this.identity,
      requestID: crypto.randomUUID(),
      kind: "fill-verification",
    });
    if (reply.kind !== "verification-filled")
      throw new Error("Private verification entry was not acknowledged");
    this.verificationFilled = true;
  }

  async submitVerification() {
    assert.ok(this.verificationFilled && !this.verificationSubmitted);
    await this.app.validate();
    const reply = await this.exchange({
      schemaVersion: 1,
      ...this.identity,
      requestID: crypto.randomUUID(),
      kind: "submit-verification",
    });
    if (reply.kind !== "verification-submitted")
      throw new Error("Private verification submission was not acknowledged");
    this.verificationSubmitted = true;
    this.submissions += 1;
  }

  async fillVaultPassword(vaultPassword: string) {
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
    assert.ok(
      this.currentStage === "vaults" &&
        (this.vaultFilled || this.connectEnabled) &&
        !this.connectSubmitted,
    );
    await this.app.validate();
    this.app.expectClose();
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
  },
  work: (session: PrivateAccountSession) => Promise<T>,
): Promise<T> {
  assert.equal(
    active,
    false,
    "Only one private account session may own the process directory",
  );
  const original = process.cwd();
  active = true;
  let session: PrivateAccountSession | undefined;
  try {
    const uid = process.getuid?.();
    assert.ok(uid !== undefined && uid !== 0);
    const directory = await lstat(options.directory);
    assert.ok(
      directory.isDirectory() &&
        !directory.isSymbolicLink() &&
        directory.uid === uid &&
        (directory.mode & 0o777) === 0o700,
    );
    assert.equal(await realpath(options.directory), options.directory);
    const name = `facet-account-${options.identity.sessionID}.sock`;
    const file = path.join(options.directory, name),
      metadata = await lstat(file);
    assert.ok(
      metadata.isSocket() &&
        !metadata.isSymbolicLink() &&
        metadata.uid === uid &&
        (metadata.mode & 0o777) === 0o600,
    );
    process.chdir(options.directory);
    const socket = createConnection({ path: name });
    session = new PrivateAccountSession(
      socket,
      options.identity,
      options.validateOwner,
      options.app,
    );
    await session.bind();
    return await work(session);
  } finally {
    session?.close();
    process.chdir(original);
    active = false;
  }
}
