import {
  RunCodeResponseSchema,
  SANDBOX_PORT,
} from "@shepherdjerred/birmel/sandbox/contracts.ts";

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(
        `http://127.0.0.1:${String(SANDBOX_PORT)}/health`,
      );
      if (response.ok) {
        return;
      }
    } catch {
      // The sidecar-style server is still starting.
    }
    await Bun.sleep(100);
  }
  throw new Error("Sandbox server did not become healthy");
}

async function runSnippet(input: {
  language: "python" | "javascript" | "typescript";
  source: string;
}): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${String(SANDBOX_PORT)}/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const result = RunCodeResponseSchema.parse(await response.json());
  if (!response.ok || !result.success || result.data == null) {
    throw new Error(`Sandbox snippet failed: ${result.message}`);
  }
  return result.data.stdout;
}

const server = Bun.spawn({
  cmd: ["tini", "-s", "--", "bun", "src/sandbox/server.ts"],
  stdout: "inherit",
  stderr: "inherit",
});

try {
  await waitForServer();
  const python = await runSnippet({
    language: "python",
    source: "print(6 * 7)",
  });
  if (python.trim() !== "42") {
    throw new Error("Python sandbox returned the wrong result");
  }

  const javascript = await runSnippet({
    language: "javascript",
    source: "console.log([1, 2, 3].reduce((a, b) => a + b, 0))",
  });
  if (javascript.trim() !== "6") {
    throw new Error("JavaScript sandbox returned the wrong result");
  }

  const typescript = await runSnippet({
    language: "typescript",
    source: "const answer: number = 40 + 2; console.log(answer)",
  });
  if (typescript.trim() !== "42") {
    throw new Error("TypeScript sandbox returned the wrong result");
  }

  const isolation = await runSnippet({
    language: "python",
    source: `import os
import socket
try:
    with open("/app/packages/birmel/package.json", "rb") as source:
        source.read(1)
except (FileNotFoundError, PermissionError):
    pass
else:
    raise AssertionError("sandbox could read application source")
assert set(os.environ) <= {"HOME", "PATH", "BUN_CONFIG_NO_INSTALL", "LC_CTYPE", "TMPDIR"}
for path in ("/tmp/persist", "/tmp/birmel-sandbox/persist", "/dev/shm/persist"):
    try:
        with open(path, "wb") as output:
            output.write(b"persist")
    except OSError:
        pass
    else:
        raise AssertionError(f"sandbox wrote outside its run directory: {path}")
try:
    socket.create_connection(("1.1.1.1", 443), timeout=1)
    raise RuntimeError("network unexpectedly available")
except OSError:
    print("isolated")`,
  });
  if (isolation.trim() !== "isolated") {
    throw new Error("Sandbox isolation checks did not complete");
  }

  const blockedPersistence = await runSnippet({
    language: "python",
    source: `import ctypes
import errno
import os
libc = ctypes.CDLL(None, use_errno=True)
librt = ctypes.CDLL("librt.so.1", use_errno=True)
queue_name = f"/birmel-{os.getpid()}".encode()
queue = librt.mq_open(queue_name, os.O_CREAT | os.O_RDWR, 0o600, None)
queue_error = ctypes.get_errno()
ipc_create = 0o1000 | 0o600
message_queue = libc.msgget(0, ipc_create)
message_queue_error = ctypes.get_errno()
shared_memory = libc.shmget(0, 4096, ipc_create)
shared_memory_error = ctypes.get_errno()
semaphore = libc.semget(0, 1, ipc_create)
semaphore_error = ctypes.get_errno()
keyutils = ctypes.CDLL("libkeyutils.so.1", use_errno=True)
key = keyutils.add_key(b"user", b"birmel-smoke", b"persist", 7, -4)
key_error = ctypes.get_errno()
for name, result, error in (
    ("mq_open", queue, queue_error),
    ("msgget", message_queue, message_queue_error),
    ("shmget", shared_memory, shared_memory_error),
    ("semget", semaphore, semaphore_error),
    ("add_key", key, key_error),
):
    if result != -1 or error != errno.EPERM:
        raise RuntimeError(f"persistent-state syscall was not blocked: {name}")
print("persistent-state-blocked")`,
  });
  if (blockedPersistence.trim() !== "persistent-state-blocked") {
    throw new Error("Sandbox persistent-state block check did not complete");
  }

  const restrictedTree = await runSnippet({
    language: "python",
    source: `import os
os.mkdir("locked", 0o700)
with open("locked/data", "w", encoding="utf-8") as output:
    output.write("sandbox-owned")
os.chmod("locked", 0)
print("restricted-tree-created")`,
  });
  if (restrictedTree.trim() !== "restricted-tree-created") {
    throw new Error("Sandbox restricted-tree cleanup check did not complete");
  }

  const concurrentHolder = runSnippet({
    language: "python",
    source: `import time
time.sleep(0.5)
import os
print(os.getuid())`,
  });
  await Bun.sleep(100);
  const concurrentProbe = await runSnippet({
    language: "python",
    source: `import os
try:
    os.listdir("/tmp/birmel-sandbox")
except PermissionError:
    print(os.getuid())
else:
    raise RuntimeError("sandbox run root was enumerable")`,
  });
  const concurrentHolderOutput = await concurrentHolder;
  const concurrentUids = new Set([
    concurrentProbe.trim(),
    concurrentHolderOutput.trim(),
  ]);
  if (
    concurrentUids.size !== 2 ||
    ![...concurrentUids].every((uid) => uid === "1001" || uid === "1002")
  ) {
    throw new Error("Concurrent sandbox isolation check did not complete");
  }

  const blockedPythonDescendant = await runSnippet({
    language: "python",
    source: `import subprocess
try:
    subprocess.Popen(["sleep", "1"])
except OSError:
    print("descendant-blocked")
else:
    raise RuntimeError("python descendant escaped the per-run process limit")`,
  });
  if (blockedPythonDescendant.trim() !== "descendant-blocked") {
    throw new Error("Python descendant process limit check did not complete");
  }

  const blockedBunDescendant = await runSnippet({
    language: "javascript",
    source: `let spawned = false;
try {
  const child = Bun.spawn(["sleep", "1"], { stdout: "ignore", stderr: "ignore" });
  spawned = (await child.exited) === 0;
} catch {
  // RLIMIT_NPROC rejects the descendant before it starts.
}
if (spawned) throw new Error("Bun descendant escaped the per-run process limit");
console.log("descendant-blocked");`,
  });
  if (blockedBunDescendant.trim() !== "descendant-blocked") {
    throw new Error("Bun descendant process limit check did not complete");
  }
} finally {
  server.kill();
  await server.exited;
}
