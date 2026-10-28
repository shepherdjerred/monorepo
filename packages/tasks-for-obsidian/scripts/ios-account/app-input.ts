import assert from "node:assert/strict";
import { mkdir, realpath, rmdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { childEnvironment } from "tasknotes-macos/scripts/mac-account-contract.ts";
import { type Manifest } from "../apple-sync-live/model";
import { assertUnchangedBuild } from "../apple-sync-live/ledger";
import { command } from "../apple-sync-live/platform";
import {
  decodeAppReply,
  decodeCorrelatedAppReply,
  AccountIdentitySchema,
  boundaryCheck,
  encodeAppCommand,
  type AccountIdentity,
  type AppReply,
  type AccountOperation,
  type VerificationSource,
  issueVerificationAfterValidation,
  assertInputClock,
  assertVerificationFresh,
} from "./contract";
import {
  inputArtifactDirectory,
  inputArtifacts,
  inputBinary,
  assertInputBundle,
  inspectInputOwner,
  type InputArtifacts,
  type ProcessLifetime,
  type HelperDiagnosticSchema,
  InputStages,
  inputBootstrap,
} from "./app-input-artifacts";

type Stage = "credentials" | "verification" | "vaults";
type Action =
  | "clear"
  | "email"
  | "password"
  | "verification"
  | "clear-vault"
  | "vault-password"
  | "finish";
export type AppInput = Pick<
  PrivateAppInput,
  | "apply"
  | "applyVerification"
  | "finish"
  | "expectClose"
  | "validate"
  | "stage"
>;

/** Only this host process and the mounted app see private field values. */
export class PrivateAppInput {
  private readonly child;
  private readonly reader;
  private buffered = Buffer.alloc(0);
  private frames = 0;
  private steps = 0;
  private hello: AppReply | undefined;
  private helperLifetime: ProcessLifetime | undefined;
  private appLifetime: ProcessLifetime | undefined;
  private appExecutable: string | undefined;
  private readonly appFiles: Record<string, string>;
  private readonly operation: AccountOperation;
  private appDirectory: string | undefined;
  private closingExpected = false;
  private readonly stages: InputStages;
  private readonly deadline = performance.now() + 120_000;
  private closeResult:
    Promise<{ status: "closed" | "cleanup-incomplete" }> | undefined;
  private readonly artifacts: InputArtifacts;
  private stderr: Promise<string> | undefined;
  readonly socketDirectory: string;
  private constructor(
    private readonly manifest: Manifest,
    private readonly identity: AccountIdentity,
    evidence: string,
    setup: {
      artifacts: InputArtifacts;
      socketDirectory: string;
      appFiles: Record<string, string>;
      operation: AccountOperation;
    },
  ) {
    this.artifacts = setup.artifacts;
    this.appFiles = Object.freeze({ ...setup.appFiles });
    this.operation = setup.operation;
    this.socketDirectory = setup.socketDirectory;
    this.child = Bun.spawn(
      [
        path.join(inputArtifactDirectory(manifest.runID), "bridge"),
        path.join(setup.socketDirectory, "input.sock"),
      ],
      {
        env: childEnvironment(Bun.env),
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    this.reader = this.child.stdout.getReader();
    this.stages = new InputStages(evidence, identity.runID, this.child.pid);
  }
  static async start(
    manifest: Manifest,
    identity: AccountIdentity,
    evidence: string,
    prepared: { appFiles: Record<string, string>; operation: AccountOperation },
  ) {
    AccountIdentitySchema.parse(identity);
    assert.ok(
      manifest.simulator !== null &&
        identity.runID === manifest.runID.toLowerCase() &&
        identity.deviceID === manifest.simulator.id.toLowerCase(),
      "Private app identity differs from its prepared run",
    );
    const artifacts = await inputArtifacts(manifest.runID);
    const socketDirectory = "/private/tmp/facet-account-" + identity.sessionID;
    await mkdir(socketDirectory, { mode: 0o700 });
    let selected: PrivateAppInput | undefined;
    try {
      selected = new PrivateAppInput(manifest, identity, evidence, {
        artifacts,
        socketDirectory,
        ...prepared,
      });
      const packet = await selected.line();
      boundaryCheck("bridge-packet", packet);
      const initial = z
        .strictObject({
          kind: z.literal("listening"),
          pid: z.number().int().positive(),
          uid: z.number().int().positive(),
        })
        .safeParse(packet);
      assert.ok(
        initial.success &&
          initial.data.pid === selected.child.pid &&
          initial.data.uid === process.getuid?.(),
        "Private app helper did not bind its owned socket",
      );
      selected.helperLifetime = await inspectInputOwner(
        inputArtifactDirectory(manifest.runID),
        artifacts,
        selected.child.pid,
        {
          executable: path.join(
            inputArtifactDirectory(manifest.runID),
            "bridge",
          ),
        },
      );
      await selected.record("helper-owned");
      return selected;
    } catch {
      if (selected === undefined) {
        try {
          await rmdir(socketDirectory);
        } catch {
          /* Preserve the primary readiness rejection. */
        }
      } else await selected.close();
      throw new Error("Private app helper did not become ready");
    }
  }
  get bootstrap() {
    return inputBootstrap(this.socketDirectory, this.child.pid, this.operation);
  }
  get stage() {
    assert.ok(this.hello !== undefined);
    return this.hello.stage;
  }
  private async record(
    stage: string,
    diagnostic?: z.infer<typeof HelperDiagnosticSchema>,
  ) {
    await this.stages.add(stage, this.hello?.appPID, diagnostic);
  }
  private async line(): Promise<unknown> {
    for (;;) {
      const newline = this.buffered.indexOf(10);
      if (newline !== -1) {
        assert.ok(
          newline > 0 && newline <= 8192 && ++this.frames <= 11,
          "Private app frame bound exceeded",
        );
        const frame = this.buffered.subarray(0, newline);
        this.buffered = this.buffered.subarray(newline + 1);
        try {
          return JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(frame),
          );
        } catch {
          throw new Error("Private app returned an invalid frame");
        }
      }
      assert.ok(
        this.buffered.length <= 8192,
        "Private app frame bound exceeded",
      );
      const left = this.deadline - performance.now();
      if (left <= 0) throw new Error("Private app input deadline expired");
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const next = await Promise.race([
        this.reader.read(),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            reject(new Error("Private app input deadline expired"));
          }, left);
        }),
      ]).finally(() => {
        if (timeout !== undefined) clearTimeout(timeout);
      });
      if (next.done) {
        await this.recordRejection();
        throw new Error("Private app peer closed before its acknowledgment");
      }
      this.buffered = Buffer.concat([this.buffered, next.value]);
    }
  }
  private async recordRejection() {
    try {
      await this.stages.rejection(await this.readStderr(), this.hello?.appPID);
    } catch {
      /* A missing diagnostic never replaces the primary protocol failure. */
    }
  }
  async bind(): Promise<AppInput> {
    const packet = await this.line();
    boundaryCheck("bridge-packet", packet);
    const peer = z
      .strictObject({
        kind: z.literal("peer"),
        pid: z.number().int().positive(),
        uid: z.number().int().positive(),
      })
      .safeParse(packet);
    assert.ok(
      peer.success &&
        peer.data.uid === process.getuid?.() &&
        this.manifest.simulator !== null,
    );
    const container = await command([
      "xcrun",
      "simctl",
      "get_app_container",
      this.manifest.simulator.id,
      "org.reactjs.native.example.TasksForObsidian",
      "app",
    ]);
    this.appExecutable = await realpath(
      path.join(container, "TasksForObsidian"),
    );
    this.appDirectory = await realpath(container);
    await assertUnchangedBuild(this.manifest);
    this.appLifetime = await inspectInputOwner(
      inputArtifactDirectory(this.manifest.runID),
      this.artifacts,
      peer.data.pid,
      { executable: this.appExecutable },
    );
    await this.validateAppBytes();
    await inspectInputOwner(
      inputArtifactDirectory(this.manifest.runID),
      this.artifacts,
      this.child.pid,
      {
        executable: path.join(
          inputArtifactDirectory(this.manifest.runID),
          "bridge",
        ),
        expected: this.helperLifetime,
      },
    );
    await this.record("app-owned");
    await this.child.stdin.write("A");
    await this.child.stdin.flush();
    const hello = decodeAppReply(await this.line());
    assert.ok(hello.kind === "hello" && hello.appPID === peer.data.pid);
    assert.ok(hello.clockUnixMilliseconds !== undefined);
    const fixture = this.operation === "fixture-verification";
    assert.equal(hello.mode, fixture ? "fixture-verification" : "account");
    assert.equal(hello.fixtureConfirmed, fixture);
    for (const [key, value] of Object.entries(this.identity))
      assert.equal(
        Reflect.get(hello, key),
        value,
        "Private app identity changed",
      );
    this.hello = hello;
    const requestID = crypto.randomUUID();
    const encoded = encodeAppCommand({
      schemaVersion: 1,
      ...this.identity,
      formEpoch: hello.formEpoch,
      token: hello.token,
      requestID,
      kind: "bind",
      expectedStage: hello.stage,
    });
    const bindStarted = performance.now();
    try {
      await this.child.stdin.write(encoded);
      await this.child.stdin.flush();
    } finally {
      encoded.fill(0);
    }
    const ready = decodeCorrelatedAppReply(await this.line(), hello);
    assertInputClock(
      z.number().int().positive().parse(ready.clockUnixMilliseconds),
      performance.now() - bindStarted,
    );
    assert.ok(
      ready.kind === "ready" &&
        ready.requestID === requestID &&
        ready.stage === hello.stage,
    );
    await this.record("bound");
    return this;
  }
  private async validateAppBytes() {
    assert.ok(
      this.appExecutable !== undefined && this.appDirectory !== undefined,
    );
    await assertInputBundle(
      this.appDirectory,
      this.appFiles,
      this.appExecutable,
    );
  }
  async validate() {
    await assertUnchangedBuild(this.manifest);
    await this.validateLive();
  }
  private async validateLive() {
    assert.ok(
      performance.now() < this.deadline,
      "Private app input deadline expired",
    );
    assert.ok(
      this.hello?.appPID !== undefined &&
        this.appExecutable !== undefined &&
        this.appLifetime !== undefined &&
        this.helperLifetime !== undefined &&
        !this.closingExpected,
    );
    const directory = inputArtifactDirectory(this.manifest.runID);
    assert.equal(
      await inputBinary(path.join(directory, "bridge")),
      this.artifacts.bridge,
    );
    await inspectInputOwner(directory, this.artifacts, this.child.pid, {
      executable: path.join(directory, "bridge"),
      expected: this.helperLifetime,
    });
    await inspectInputOwner(directory, this.artifacts, this.hello.appPID, {
      executable: this.appExecutable,
      expected: this.appLifetime,
    });
    await this.validateAppBytes();
    assert.ok(
      performance.now() < this.deadline,
      "Private app input deadline expired",
    );
  }
  async apply(action: Action, expectedStage: Stage, value?: string) {
    assert.notEqual(
      action,
      "verification",
      "Verification requires a fresh one-shot value",
    );
    await this.validate();
    await this.deliver(action, expectedStage, value);
  }
  async applyVerification(source: VerificationSource) {
    const value = await issueVerificationAfterValidation(
      () => this.validate(),
      source,
      () => this.validateLive(),
    );
    await this.deliver(
      "verification",
      "verification",
      value.code,
      value.expiresAtUnixMilliseconds,
    );
    return value.expiresAtUnixMilliseconds;
  }
  private async deliver(
    action: Action,
    expectedStage: Stage,
    value?: string,
    expiresAtUnixMilliseconds?: number,
  ) {
    assert.ok(++this.steps <= 7 && !this.closingExpected);
    if (expiresAtUnixMilliseconds !== undefined)
      assertVerificationFresh(expiresAtUnixMilliseconds);
    const hello = this.hello;
    assert.ok(hello !== undefined);
    const requestID = crypto.randomUUID(),
      bytes = encodeAppCommand({
        schemaVersion: 1,
        ...this.identity,
        formEpoch: hello.formEpoch,
        token: hello.token,
        requestID,
        kind: action,
        expectedStage,
        ...(value === undefined ? {} : { value }),
        ...(expiresAtUnixMilliseconds === undefined
          ? {}
          : { expiresAtUnixMilliseconds }),
      });
    try {
      await this.child.stdin.write(bytes);
      await this.child.stdin.flush();
    } finally {
      bytes.fill(0);
    }
    const reply = decodeCorrelatedAppReply(await this.line(), hello);
    assert.ok(
      reply.kind === "applied" &&
        reply.requestID === requestID &&
        reply.action === action &&
        reply.stage === expectedStage,
      "Private app action was not acknowledged",
    );
    await this.record("applied-" + action);
  }
  async expectClose() {
    this.closingExpected = true;
    const result = await this.close();
    assert.equal(
      result.status,
      "closed",
      "Private app transport did not close cleanly",
    );
  }
  async finish(stage: Stage) {
    if (!this.closingExpected) {
      await this.apply("finish", stage);
      await this.expectClose();
    }
  }
  close() {
    this.closeResult ??= this.cleanup();
    return this.closeResult;
  }
  private readStderr() {
    this.stderr ??= new Response(this.child.stderr).text();
    return this.stderr;
  }
  private async cleanup(): Promise<{
    status: "closed" | "cleanup-incomplete";
  }> {
    let incomplete = false;
    try {
      await this.record("closing");
    } catch {
      incomplete = true;
    }
    try {
      await this.child.stdin.end();
    } catch {
      incomplete = true;
    }
    try {
      await this.reader.cancel();
    } catch {
      incomplete = true;
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const code = await Promise.race([
        this.child.exited,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            reject(new Error("Private helper cleanup deadline"));
          }, 5000);
        }),
      ]);
      const stderr = await this.readStderr();
      if (code !== 0 || stderr !== "") incomplete = true;
      await rmdir(this.socketDirectory);
    } catch {
      incomplete = true;
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
    this.buffered.fill(0);
    this.hello = undefined;
    try {
      await this.record(incomplete ? "cleanup-incomplete" : "closed");
    } catch {
      incomplete = true;
    }
    return { status: incomplete ? "cleanup-incomplete" : "closed" };
  }
}
