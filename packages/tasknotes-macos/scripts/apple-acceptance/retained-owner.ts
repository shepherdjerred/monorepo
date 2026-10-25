import assert from "node:assert/strict";
import path from "node:path";

const schema: unknown = await Bun.file(
  path.join(import.meta.dir, "occurrence-launches.schema.json"),
).json();

export type Lifetime = {
  uid: number;
  ruid: number;
  startSeconds: number;
  startMicroseconds: number;
};
export type Launch = {
  pid: number;
  identity: Lifetime;
  state: "running" | "closed";
};
export type RunBinding = {
  runID: string;
  descriptor: string;
  executable: string;
};
export type LaunchJournal = RunBinding & {
  schemaVersion: 1;
  launches: Launch[];
};
export type OwnerControls = {
  inspect: () => Promise<number[]>;
  identity: (pid: number) => Promise<Lifetime | null>;
  terminate: (pid: number, expected: Lifetime) => Promise<void>;
  now: () => number;
  pause: (milliseconds: number) => Promise<unknown>;
};
function object(value: unknown): asserts value is Record<string, unknown> {
  assert.ok(
    value !== null && typeof value === "object" && !Array.isArray(value),
  );
}
function keys(value: Record<string, unknown>, expected: string[]): void {
  assert.deepEqual(Object.keys(value).sort(), expected.sort());
}
function contractFields(
  definition: "identity" | "launch" | "journal",
): string[] {
  object(schema);
  const definitions = schema["$defs"];
  object(definitions);
  const rule = definitions[definition];
  object(rule);
  const required = rule["required"];
  assert.ok(
    Array.isArray(required) &&
      required.every((field: unknown) => typeof field === "string"),
  );
  return required;
}
export function lifetime(value: unknown): Lifetime {
  object(value);
  keys(value, contractFields("identity"));
  for (const key of ["uid", "ruid", "startSeconds", "startMicroseconds"]) {
    const field: unknown = value[key];
    assert.ok(
      typeof field === "number" && Number.isSafeInteger(field) && field >= 0,
    );
  }
  assert.ok(
    Number(value["startSeconds"]) > 0 &&
      Number(value["startMicroseconds"]) < 1_000_000,
  );
  assert.ok(
    Number(value["uid"]) <= 4_294_967_295 &&
      Number(value["ruid"]) <= 4_294_967_295,
  );
  return {
    uid: Number(value["uid"]),
    ruid: Number(value["ruid"]),
    startSeconds: Number(value["startSeconds"]),
    startMicroseconds: Number(value["startMicroseconds"]),
  };
}
export function launchJournal(
  value: unknown,
  binding: RunBinding,
): LaunchJournal {
  object(value);
  keys(value, contractFields("journal"));
  assert.match(
    binding.runID,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
  );
  for (const file of [binding.descriptor, binding.executable])
    assert.ok(file.startsWith("/") && file.length <= 4096);
  assert.equal(value["schemaVersion"], 1);
  for (const key of ["runID", "descriptor", "executable"] as const)
    assert.equal(
      value[key],
      binding[key],
      "Launch journal belongs to another run",
    );
  const entries = value["launches"];
  assert.ok(Array.isArray(entries) && entries.length <= 4);
  const launches = entries.map((entry: unknown, index: number): Launch => {
    object(entry);
    keys(entry, contractFields("launch"));
    const pid = entry["pid"];
    assert.ok(
      typeof pid === "number" &&
        Number.isSafeInteger(pid) &&
        pid > 0 &&
        pid <= 2_147_483_647,
    );
    const state = entry["state"];
    assert.ok(
      state === "closed" ||
        (state === "running" && index === entries.length - 1),
    );
    return { pid, identity: lifetime(entry["identity"]), state };
  });
  const identities = launches.map((entry) =>
    JSON.stringify([entry.pid, entry.identity]),
  );
  assert.equal(
    new Set(identities).size,
    identities.length,
    "A cold launch must capture a new process lifetime",
  );
  return { ...binding, schemaVersion: 1, launches };
}

/** Discovery confirms absence or the retained identity; it never grants retirement authority. */
export async function retireRetainedOwner(
  journal: LaunchJournal | null,
  binding: RunBinding,
  controls: OwnerControls,
  budgetMS = 10_000,
): Promise<{ signalSubmitted: boolean; observedExit: true }> {
  const retained = journal === null ? null : launchJournal(journal, binding);
  const owners = await controls.inspect();
  assert.ok(owners.length <= 1, "Unexpected acceptance process owners");
  const current = owners[0];
  if (current === undefined)
    return { signalSubmitted: false, observedExit: true };
  const expected = retained?.launches.at(-1);
  assert.ok(
    expected?.state === "running",
    "An unowned replacement must be left running",
  );
  assert.equal(
    current,
    expected.pid,
    "An unowned replacement must be left running",
  );
  assert.deepEqual(
    await controls.identity(current),
    expected.identity,
    "A reused PID must be left running",
  );
  await controls.terminate(current, expected.identity);
  const deadline = controls.now() + budgetMS;
  for (;;) {
    const present = await controls.inspect();
    if (present.length === 0)
      return { signalSubmitted: true, observedExit: true };
    assert.deepEqual(
      present,
      [expected.pid],
      "A replacement during retirement must be left running",
    );
    assert.deepEqual(
      await controls.identity(expected.pid),
      expected.identity,
      "A reused PID during retirement must be left running",
    );
    assert.ok(
      controls.now() < deadline,
      "Retained owner did not exit within cleanup deadline",
    );
    await controls.pause(Math.min(50, deadline - controls.now()));
  }
}
