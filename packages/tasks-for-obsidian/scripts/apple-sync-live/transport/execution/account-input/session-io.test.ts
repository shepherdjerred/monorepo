import { expect, test } from "vitest";
import { createMacPrivateIO } from "./session";

function fixture(
  options: {
    openOutput?: boolean;
    openErrors?: boolean;
    cancelStalls?: boolean;
  } = {},
) {
  const counts = { outputCanceled: 0, errorsCanceled: 0, terminated: 0 };
  const output = new TextEncoder().encode('{"synthetic":true}\n');
  const stdout = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(output);
      if (!options.openOutput) controller.close();
    },
    cancel() {
      counts.outputCanceled += 1;
      return options.cancelStalls
        ? Promise.withResolvers<undefined>().promise
        : Promise.resolve();
    },
  });
  const stderr = new ReadableStream<Uint8Array>({
    start(controller) {
      if (!options.openErrors) controller.close();
    },
    cancel() {
      counts.errorsCanceled += 1;
    },
  });
  const io = createMacPrivateIO(
    {
      stdout,
      stderr,
      exitCode: 0,
      exited: Promise.resolve(0),
      stdin: { write: () => 0, flush: () => 0, end: () => 0 },
    },
    true,
    performance.now() + 100,
    () => {
      counts.terminated += 1;
    },
  );
  return { io, counts, output };
}

test.each([{ openOutput: true }, { openErrors: true }])(
  "exited leader with inherited open pipes cannot finish or signal a reused group (%j)",
  async (options) => {
    const { io, counts, output } = fixture(options);
    expect(await io.read()).toEqual({ synthetic: true });
    await expect(io.finish()).rejects.toThrow();
    await expect(io.abort()).rejects.toThrow("deadline");
    expect(io.capture()).toEqual({
      stdout: Buffer.from(output),
      stderr: Buffer.alloc(0),
      complete: false,
    });
    expect(counts.terminated).toBe(0);
    expect(
      options.openOutput ? counts.outputCanceled : counts.errorsCanceled,
    ).toBe(1);
  },
);

test("abort cancels inherited streams immediately without inventing EOF or losing captured bytes", async () => {
  const { io, counts, output } = fixture({
    openOutput: true,
    openErrors: true,
  });
  expect(await io.read()).toEqual({ synthetic: true });
  await io.abort();
  expect(counts).toEqual({
    outputCanceled: 1,
    errorsCanceled: 1,
    terminated: 0,
  });
  expect(io.capture()).toEqual({
    stdout: Buffer.from(output),
    stderr: Buffer.alloc(0),
    complete: false,
  });
});

test("an unresponsive stream cancel remains bounded by the original absolute deadline", async () => {
  const { io, counts } = fixture({ openOutput: true, cancelStalls: true });
  expect(await io.read()).toEqual({ synthetic: true });
  await expect(io.abort()).rejects.toThrow("deadline");
  expect(counts.terminated).toBe(0);
  expect(io.capture().complete).toBe(false);
});

test("only real EOF, exit zero and empty diagnostics can mark transport complete", async () => {
  const { io, counts, output } = fixture();
  expect(await io.read()).toEqual({ synthetic: true });
  await io.finish();
  expect(counts.terminated).toBe(0);
  expect(io.capture()).toEqual({
    stdout: Buffer.from(output),
    stderr: Buffer.alloc(0),
    complete: true,
  });
});
