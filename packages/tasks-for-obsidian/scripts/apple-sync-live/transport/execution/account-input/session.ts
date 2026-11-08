import assert from "node:assert/strict";
import { z } from "zod";
import { childEnvironment } from "tasknotes-macos/scripts/mac-account-contract";
import {
  macInputFrame,
  macInputProtocol,
  macInputWire,
  macVerificationTiming,
  MacInputFinishedSchema,
  MacInputReadySchema,
  type MacInputPrepared,
} from "./protocol";

export type MacInputCapture = {
  stdout: Uint8Array;
  stderr: Uint8Array;
  complete: boolean;
};
export type MacInputIO = {
  send: (
    frame: "init" | "probe" | "credentials" | "verification" | "vault",
    value: unknown,
  ) => Promise<void>;
  read: () => Promise<unknown>;
  finish: () => Promise<void>;
  abort: () => Promise<void>;
};

/** All expensive checks precede the caller's late private value supplier. */
export async function driveMacInput(
  prepared: MacInputPrepared,
  io: MacInputIO,
  options: {
    fresh: () => Promise<void>;
    action: () => Promise<Record<string, unknown>>;
    recordIntent: () => Promise<void>;
    now?: () => number;
  },
) {
  const now = options.now ?? Date.now;
  const deadline = now() + macInputProtocol.limits.sessionMilliseconds;
  const { input } = prepared;
  const operation = macInputProtocol.operations[input.operation];
  await io.send("init", input);
  const ready = MacInputReadySchema.parse(
    macInputFrame("ready", await io.read()),
  );
  for (const key of [
    "sessionID",
    "runID",
    "operation",
    "pid",
    "startSeconds",
    "startMicroseconds",
    "launchDate",
    "requestID",
  ] as const)
    assert.equal(ready[key], input[key], "Mac private READY owner changed");
  assert.equal(ready.phase, operation.phase);
  assert.ok(
    Math.abs(now() - ready.clockUnixMilliseconds) <=
      macVerificationTiming.maximumClockSkewMilliseconds,
    "Mac private clock differs",
  );
  await options.fresh();
  assert.ok(
    now() < deadline,
    "Mac private deadline expired before credential lookup",
  );
  const action = await options.action();
  assert.ok(
    now() < deadline,
    "Mac private deadline expired during credential preparation",
  );
  const frame = operation.probe ? "probe" : input.operation;
  assert.ok(
    frame === "probe" ||
      frame === "credentials" ||
      frame === "verification" ||
      frame === "vault",
  );
  if (frame === "verification") {
    const expiry = z
      .number()
      .int()
      .positive()
      .parse(action["expiresAtUnixMilliseconds"]);
    assert.ok(expiry > now(), "Mac verification expired before delivery");
    assert.ok(
      expiry - now() <=
        macVerificationTiming.maximumValidityMilliseconds +
          macVerificationTiming.maximumClockSkewMilliseconds,
    );
  }
  if (!operation.probe) await options.recordIntent();
  assert.ok(
    now() < deadline,
    "Mac private deadline expired while recording intent",
  );
  if (frame === "verification")
    assert.ok(
      z.number().int().positive().parse(action["expiresAtUnixMilliseconds"]) >
        now(),
      "Mac verification expired while recording intent",
    );
  await io.send(frame, { ...action, kind: frame, sessionID: input.sessionID });
  const finished = MacInputFinishedSchema.parse(
    macInputFrame("finished", await io.read()),
  );
  for (const key of ["sessionID", "runID", "operation"] as const)
    assert.equal(finished[key], input[key]);
  assert.equal(finished.phase, operation.phase);
  assert.equal(finished.cleared, operation.probe);
  assert.equal(
    finished.submitActionCount,
    operation.accountSubmits + operation.codeSubmits + operation.connects,
  );
  assert.equal(
    finished.verificationCodeSubmitActionCount,
    operation.codeSubmits,
  );
  assert.equal(finished.secureField, operation.phase !== "verification");
  assert.equal(
    finished.intentRecorded,
    !operation.probe || operation.accountSubmits === 1,
  );
  await io.finish();
  return finished;
}

/** Only synthetic sessions retain raw output. Real frames and failures stay in memory. */
export function startMacPrivateIO(
  vm: string,
  program: string,
  probe: boolean,
): MacInputIO & {
  capture: () => MacInputCapture;
  assertLive: () => void;
} {
  assert.match(vm, /^[A-Za-z0-9][\w.-]{0,80}$/u);
  assert.ok(program.startsWith("/") && !/\p{Cc}/u.test(program));
  const child = Bun.spawn(["tart", "exec", "-i", vm, program], {
    env: childEnvironment(Bun.env),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    detached: true,
  });
  return createMacPrivateIO(
    child,
    probe,
    performance.now() + macInputProtocol.limits.sessionMilliseconds,
    () => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    },
  );
}

type MacPrivateProcess = {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  stdin: Pick<Bun.FileSink, "write" | "flush" | "end">;
  exitCode: number | null;
  exited: Promise<number>;
};
type MacPrivateReader = {
  read: () => Promise<
    | { done: true; value?: Uint8Array | undefined }
    | { done: false; value: Uint8Array }
  >;
  cancel: () => Promise<void>;
};

/** The process/stream boundary accepts an absolute deadline; production always supplies 120s. */
export function createMacPrivateIO(
  child: MacPrivateProcess,
  probe: boolean,
  deadline: number,
  terminateOwned: () => void,
): MacInputIO & { capture: () => MacInputCapture; assertLive: () => void } {
  return new MacPrivateChannel(child, probe, deadline, terminateOwned);
}

class MacPrivateChannel implements MacInputIO {
  private readonly reader: MacPrivateReader;
  private readonly errors: MacPrivateReader;
  private readonly chunks: Uint8Array[] = [];
  private readonly errorChunks: Uint8Array[] = [];
  private buffer = new Uint8Array(0);
  private total = 0;
  private incomplete = false;
  private complete = false;
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly expired: Promise<never>;
  private readonly stderr: Promise<number>;

  constructor(
    private readonly child: MacPrivateProcess,
    private readonly probe: boolean,
    private readonly deadline: number,
    private readonly terminateOwned: () => void,
  ) {
    this.reader = child.stdout.getReader();
    this.errors = child.stderr.getReader();
    const expiration = Promise.withResolvers<never>();
    const expired = expiration.promise;
    this.expired = expired;
    this.timer = setTimeout(
      () => {
        this.incomplete = true;
        this.stop();
        void this.cancelReaders();
        expiration.reject(new Error("Mac private deadline expired"));
      },
      Math.max(0, deadline - performance.now()),
    );
    void (async () => {
      try {
        await expired;
      } catch {
        /* A deadline can expire before the next caller awaits. */
      }
    })();
    this.stderr = this.readErrors();
  }

  assertLive = () => {
    assert.ok(
      this.child.exitCode === null &&
        performance.now() < this.deadline &&
        !this.incomplete,
      "Mac private channel is no longer live",
    );
  };

  private async bounded<T>(work: Promise<T>): Promise<T> {
    assert.ok(
      performance.now() < this.deadline,
      "Mac private deadline expired",
    );
    return Promise.race([work, this.expired]);
  }

  private stop() {
    if (this.child.exitCode !== null) return;
    try {
      this.terminateOwned();
    } catch {
      this.incomplete = true;
    }
  }

  private async cancelReaders() {
    await Promise.allSettled([this.reader.cancel(), this.errors.cancel()]);
  }

  private async readErrors() {
    let size = 0;
    try {
      for (;;) {
        const next = await this.bounded(this.errors.read());
        if (next.done) return size;
        size += next.value.length;
        if (this.probe) this.errorChunks.push(new Uint8Array(next.value));
        if (size > 65_536)
          throw new Error("Mac private diagnostics exceeded bound");
      }
    } catch {
      this.incomplete = true;
      this.stop();
      return -1;
    }
  }

  private async nextOutput() {
    const next = await this.bounded(this.reader.read());
    if (!next.done) {
      this.total += next.value.length;
      if (this.probe) this.chunks.push(new Uint8Array(next.value));
      if (this.total > macInputProtocol.limits.frameBytes * 2) {
        this.incomplete = true;
        this.stop();
        throw new Error("Mac private output exceeded bound");
      }
    }
    return next;
  }

  async send(frame: Parameters<MacInputIO["send"]>[0], value: unknown) {
    this.assertLive();
    const bytes = macInputWire(frame, value);
    try {
      await this.bounded(Promise.resolve(this.child.stdin.write(bytes)));
      await this.bounded(Promise.resolve(this.child.stdin.flush()));
    } finally {
      bytes.fill(0);
    }
  }

  async read(): Promise<unknown> {
    for (;;) {
      const newline = this.buffer.indexOf(10);
      if (newline !== -1) {
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        try {
          return JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(line),
          ) as unknown;
        } catch {
          throw new Error("Mac private reply is malformed");
        } finally {
          line.fill(0);
        }
      }
      const next = await this.nextOutput();
      if (next.done)
        throw new Error("Mac private channel ended before receipt");
      const joined = new Uint8Array(this.buffer.length + next.value.length);
      joined.set(this.buffer);
      joined.set(next.value, this.buffer.length);
      this.buffer.fill(0);
      this.buffer = joined;
      if (this.buffer.length > macInputProtocol.limits.frameBytes) {
        this.incomplete = true;
        this.stop();
        throw new Error("Mac private frame exceeded bound");
      }
    }
  }

  async finish() {
    await this.bounded(Promise.resolve(this.child.stdin.end()));
    assert.equal(this.buffer.length, 0, "Mac private trailing output");
    const next = await this.nextOutput();
    assert.ok(next.done, "Mac private trailing output");
    assert.equal(
      await this.bounded(this.child.exited),
      0,
      "Mac private native rejected operation",
    );
    assert.equal(
      await this.bounded(this.stderr),
      0,
      "Mac private native emitted diagnostics",
    );
    assert.equal(this.incomplete, false, "Mac private capture incomplete");
    this.complete = true;
    clearTimeout(this.timer);
  }

  async abort() {
    this.incomplete = true;
    this.complete = false;
    this.stop();
    try {
      const closeInput = async () => {
        await this.child.stdin.end();
      };
      await this.bounded(
        Promise.allSettled([this.cancelReaders(), closeInput()]),
      );
      await this.bounded(this.child.exited);
      await this.bounded(this.stderr);
    } finally {
      clearTimeout(this.timer);
    }
  }

  capture = (): MacInputCapture => ({
    stdout: Buffer.concat(this.chunks),
    stderr: Buffer.concat(this.errorChunks),
    complete: this.complete && !this.incomplete,
  });
}
