import { mkdtemp, chmod, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { productionCommand } from "#scripts/prepare-production.ts";

test("transfers a credential template on a real OS pipe", async () => {
  const template = JSON.stringify({
    fields: [{ value: "private-test-fixture" }],
  });
  const result = await productionCommand(
    [
      "python3",
      "-c",
      "import json,os,stat,sys; assert stat.S_ISFIFO(os.fstat(0).st_mode); data=json.load(sys.stdin); print(len(data['fields'][0]['value']))",
    ],
    template,
  );
  expect(result.trim()).toBe(String("private-test-fixture".length));
});

test("keeps echoed credential templates private on a failed 1Password command", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "storm-production-op-"),
  );
  try {
    const executable = path.join(directory, "op");
    await writeFile(
      executable,
      '#!/bin/sh\ncat >&2\nprintf "\\nrejected template\\n" >&2\nexit 7\n',
    );
    await chmod(executable, 0o700);
    const template = JSON.stringify({
      fields: [
        { value: "private-test-fixture" },
        { value: JSON.stringify({ secretKey: 'nested-"private-fixture"' }) },
      ],
    });
    await expect(
      productionCommand([executable, "item", "create", "-"], template),
    ).rejects.toThrow(/^op exited 7$/);
    await expect(
      productionCommand([executable, "item", "create", "-"], template),
    ).rejects.not.toThrow("private-test-fixture");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("does not include other subprocess output in failure diagnostics", async () => {
  await expect(
    productionCommand(["sh", "-c", "cat >&2; exit 3"], "private-test-fixture"),
  ).rejects.toThrow(/^sh exited 3$/);
});
