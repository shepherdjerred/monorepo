import { expect, test } from "vitest";
import { captureMacProcess } from "./collect";

const bytes = new TextEncoder().encode("public-synthetic-output");
function stream(open: boolean, stalledCancel = false) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      if (!open) controller.close();
    },
    cancel() {
      if (stalledCancel)
        return new Promise<void>(() => {
          /* Intentionally unresponsive producer. */
        });
      return Promise.resolve();
    },
  });
}
test.each(["stdout", "stderr"])(
  "collector bounds inherited %s after leader exit without signaling reused owners",
  async (opened) => {
    let signals = 0;
    const child = {
      stdout: stream(opened === "stdout"),
      stderr: stream(opened === "stderr"),
      exitCode: 0,
      exited: Promise.resolve(0),
    };
    const captured = await captureMacProcess(
      child,
      performance.now() + 50,
      () => {
        signals += 1;
      },
    );
    expect(captured.complete).toBe(false);
    expect(captured.timedOut).toBe(true);
    expect(Buffer.from(captured.stdout)).toEqual(Buffer.from(bytes));
    expect(Buffer.from(captured.stderr)).toEqual(Buffer.from(bytes));
    expect(signals).toBe(0);
  },
);
test("unresponsive stream cancellation cannot extend the original collection deadline", async () => {
  const child = {
    stdout: stream(true, true),
    stderr: stream(false),
    exitCode: 0,
    exited: Promise.resolve(0),
  };
  const captured = await captureMacProcess(
    child,
    performance.now() + 50,
    () => {
      throw new Error("Exited leader cannot be signaled");
    },
  );
  expect(captured.complete).toBe(false);
  expect(captured.timedOut).toBe(true);
  expect(Buffer.from(captured.stdout)).toEqual(Buffer.from(bytes));
});
test("only both real EOFs and settled exit produce complete captured output", async () => {
  const child = {
    stdout: stream(false),
    stderr: stream(false),
    exitCode: 0,
    exited: Promise.resolve(0),
  };
  const captured = await captureMacProcess(
    child,
    performance.now() + 1000,
    () => {
      throw new Error("No live leader");
    },
  );
  expect(captured.complete).toBe(true);
  expect(captured.timedOut).toBe(false);
  expect(captured.exitCode).toBe(0);
});
