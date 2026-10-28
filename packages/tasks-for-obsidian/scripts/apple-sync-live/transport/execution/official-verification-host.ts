import assert from "node:assert/strict";
import { z } from "zod";
import { readInstalledLocalAccount } from "tasknotes-macos/scripts/local-credentials/broker";
import { childEnvironment } from "tasknotes-macos/scripts/mac-account-contract";
import { runDirectory, type Manifest } from "../../model";
import { requestGuest } from "../client";
import {
  readHostVerificationCode,
  type HostCredentialParameters,
} from "./credential-host";
import {
  OfficialVerificationPreparedSchema,
  verificationFrame,
  verificationProtocol,
  verificationWire,
} from "./official-verification-protocol";
import {
  retainVerificationMeasurement,
  requireVerificationMeasurement,
  type VerificationCapture,
} from "./official-verification-measurement";

type Prepared = z.infer<typeof OfficialVerificationPreparedSchema>;
export type FreshCode = {
  code: string;
  issuedAtEpochMs: number;
  validUntilEpochMs: number;
};
export type VerificationIO = {
  send: (frame: string, value: Record<string, unknown>) => Promise<void>;
  read: () => Promise<unknown>;
  finish: () => Promise<void>;
  abort: () => Promise<void>;
};

export async function retainFailedVerification(
  abort: () => Promise<void>,
  retain: () => Promise<void>,
): Promise<"retained" | "cleanup-failed" | "retention-failed"> {
  let cleanupFailed = false;
  try {
    await abort();
  } catch {
    cleanupFailed = true;
  }
  try {
    await retain();
  } catch {
    return "retention-failed";
  }
  return cleanupFailed ? "cleanup-failed" : "retained";
}

export async function driveOfficialVerification(
  prepared: Prepared,
  operation: "probe" | "verify",
  io: VerificationIO,
  options: {
    fresh: () => Promise<void>;
    readCode: () => Promise<FreshCode>;
    markSubmitting: () => void;
    now?: () => number;
  },
) {
  const now = options.now ?? Date.now;
  const packet: Record<string, unknown> = { ...prepared.input, operation };
  await io.send("init", packet);
  const ready = verificationFrame("ready", await io.read());
  for (const key of [
    "sessionID",
    "runID",
    "challengeID",
    "pid",
    "startSeconds",
    "startMicroseconds",
    "launchDate",
  ])
    assert.equal(ready[key], packet[key]);
  assert.ok(
    Math.abs(now() - z.number().parse(ready["clockEpochMs"])) <=
      verificationProtocol.limits.clockSkewMs,
    "Guest clock differs from host",
  );
  // Complete expensive source/artifact/guest checks before requesting any real code.
  await options.fresh();
  const common: Record<string, unknown> = {
    sessionID: packet["sessionID"],
    runID: packet["runID"],
    challengeID: packet["challengeID"],
  };
  if (operation === "probe")
    await io.send("probe", { kind: "probe", ...common });
  else {
    const value = await options.readCode();
    assert.ok(
      value.validUntilEpochMs - now() >= verificationProtocol.limits.deliveryMs,
      "Verification window is too short",
    );
    assert.ok(
      Math.abs(now() - value.issuedAtEpochMs) <=
        verificationProtocol.limits.clockSkewMs,
    );
    options.markSubmitting();
    await io.send("code", { kind: "code", ...common, ...value });
  }
  const finished = verificationFrame("finished", await io.read());
  for (const key of ["sessionID", "runID", "challengeID"])
    assert.equal(finished[key], common[key]);
  assert.equal(finished["cleared"], operation === "probe");
  assert.equal(finished["submitActionCount"], operation === "probe" ? 0 : 1);
  await io.finish();
  return finished;
}

async function freshCachedCode(
  locators: HostCredentialParameters,
): Promise<FreshCode> {
  const local = readInstalledLocalAccount({
    account: locators["--account"],
    vault: locators["--vault"],
    item: locators["--item"],
  });
  assert.ok(local.otp !== undefined, "Local OTP seed was not enrolled");
  const period = local.otp.period * 1000;
  let current = Date.now();
  let expiry = (Math.floor(current / period) + 1) * period;
  if (expiry - current < verificationProtocol.limits.minimumRemainingMs) {
    // The next validity counter is the gate, rather than an arbitrary soak delay.
    await Bun.sleep(expiry - current + 1);
    current = Date.now();
    expiry = (Math.floor(current / period) + 1) * period;
  }
  const code = readHostVerificationCode(locators, "keychain");
  const issuedAtEpochMs = Date.now();
  assert.equal(
    Math.floor(issuedAtEpochMs / period),
    Math.floor(current / period),
    "Code validity counter changed during local read",
  );
  assert.ok(
    expiry - issuedAtEpochMs >= verificationProtocol.limits.minimumRemainingMs,
  );
  return { code, issuedAtEpochMs, validUntilEpochMs: expiry };
}

function privateSession(
  vm: string,
  prepared: Prepared,
  probe: boolean,
): VerificationIO & { capture: () => VerificationCapture } {
  const child = Bun.spawn(["tart", "exec", "-i", vm, prepared.program], {
    env: childEnvironment(Bun.env),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    detached: true,
  });
  const reader = child.stdout.getReader();
  const errorReader = child.stderr.getReader();
  let buffered = new Uint8Array(0),
    total = 0;
  const outputChunks: Uint8Array[] = [],
    errorChunks: Uint8Array[] = [];
  const stop = () => {
    if (child.exitCode === null) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }
  };
  const timer = setTimeout(stop, verificationProtocol.limits.sessionMs + 5000);
  const stderr = (async () => {
    let size = 0;
    try {
      for (;;) {
        const result = await errorReader.read();
        if (result.done) return size;
        size += result.value.length;
        if (probe) errorChunks.push(new Uint8Array(result.value));
        if (size > 4096) {
          stop();
          return -1;
        }
      }
    } catch {
      stop();
      return -1;
    }
  })();
  return {
    send: async (frame, value) => {
      const bytes = verificationWire(frame, value);
      try {
        await child.stdin.write(bytes);
        await child.stdin.flush();
      } finally {
        bytes.fill(0);
      }
    },
    read: async () => {
      for (;;) {
        const newline = buffered.indexOf(10);
        if (newline !== -1) {
          const line = buffered.slice(0, newline);
          buffered = buffered.slice(newline + 1);
          try {
            const parsed: unknown = JSON.parse(
              new TextDecoder("utf-8", { fatal: true }).decode(line),
            );
            return parsed;
          } catch {
            throw new Error(
              "Official verification returned an invalid private frame",
            );
          }
        }
        const next = await reader.read();
        if (next.done)
          throw new Error("Official verification ended before its receipt");
        total += next.value.length;
        if (probe) outputChunks.push(new Uint8Array(next.value));
        assert.ok(total <= verificationProtocol.limits.frameBytes * 2);
        const combined = new Uint8Array(buffered.length + next.value.length);
        combined.set(buffered);
        combined.set(next.value, buffered.length);
        buffered = combined;
        assert.ok(buffered.length <= verificationProtocol.limits.frameBytes);
      }
    },
    finish: async () => {
      await child.stdin.end();
      const next = await reader.read();
      assert.ok(next.done && buffered.length === 0);
      assert.equal(await child.exited, 0);
      assert.equal(await stderr, 0);
      clearTimeout(timer);
    },
    abort: async () => {
      clearTimeout(timer);
      stop();
      await child.exited;
      try {
        await stderr;
      } catch {
        /* Only a closed classification escapes this private process. */
      }
    },
    capture: () => ({
      stdout: Buffer.concat(outputChunks),
      stderr: Buffer.concat(errorChunks),
    }),
  };
}

export async function runOfficialVerification(
  manifest: Extract<Manifest, { schemaVersion: 3 }>,
  operation: "probe" | "verify",
  options: {
    fresh: () => Promise<void>;
    locators?: HostCredentialParameters;
    markSubmitting: () => void;
  },
) {
  await options.fresh();
  const reply = await requestGuest(manifest, {
    kind: "official-verification-prepare",
    operation,
  });
  assert.equal(reply.kind, "official-verification-prepare");
  const prepared = OfficialVerificationPreparedSchema.parse(reply.prepared);
  assert.ok(
    prepared.program.startsWith(
      runDirectory(manifest.runID) + "/official-account/verification/",
    ),
  );
  assert.match(
    prepared.program,
    /\/verification\/[a-f0-9-]{36}\/official-account$/u,
  );
  assert.equal(prepared.input["runID"], manifest.runID);
  assert.equal(
    prepared.input["configSHA256"],
    manifest.execution.guestConfigSHA256,
  );
  if (operation === "verify") await requireVerificationMeasurement(prepared);
  const io = privateSession(
    manifest.execution.vm,
    prepared,
    operation === "probe",
  );
  let measurementAttempted = false;
  try {
    const result = await driveOfficialVerification(prepared, operation, io, {
      fresh: async () => {
        await options.fresh();
        if (operation === "verify")
          await requireVerificationMeasurement(prepared);
      },
      readCode: async () => {
        assert.ok(options.locators !== undefined);
        return freshCachedCode(options.locators);
      },
      markSubmitting: options.markSubmitting,
    });
    if (operation === "probe") {
      measurementAttempted = true;
      await retainVerificationMeasurement(prepared, io.capture(), true);
    }
    return result;
  } catch {
    const cleanup = await retainFailedVerification(io.abort, async () => {
      if (operation === "probe" && !measurementAttempted)
        await retainVerificationMeasurement(prepared, io.capture(), false);
    });
    throw new Error(
      `Official verification session stopped (${cleanup}); inspect retained intent before retrying`,
    );
  }
}
