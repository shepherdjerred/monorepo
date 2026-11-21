// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  useControl,
  type Control,
  type Outcome,
} from "@shepherdjerred/streambot/web/client/use-control.ts";
import { deferred, mount, perform, settle, type Deferred } from "./harness.ts";

let control: Control | null = null;

function Probe() {
  const current = useControl();
  control = current;
  const state = current.state;
  return (
    <p>
      {state.status === "done"
        ? state.message
        : state.status === "failed"
          ? state.copy.text
          : state.status}
    </p>
  );
}

function latest(): Control {
  if (control === null) throw new Error("The probe did not render");
  return control;
}

/** A task that records each start and the signal it got, and finishes when the test says. */
function slowTask() {
  const runs: Run[] = [];
  const task = vi.fn(async (signal: AbortSignal) => {
    const done = deferred<Outcome>();
    runs.push({ signal, done });
    return done.promise;
  });
  return { task, runs };
}

type Run = { signal: AbortSignal; done: Deferred<Outcome> };

async function finish(run: Run | undefined, outcome: Outcome) {
  if (run === undefined) throw new Error("The task never started");
  await perform(() => {
    run.done.resolve(outcome);
  });
}

afterEach(() => {
  control = null;
});

describe("useControl", () => {
  test("unmounting never cancels a sent command, and its late result is dropped", async () => {
    const view = await mount(<Probe />);
    const { task, runs } = slowTask();
    const errors = vi.spyOn(console, "error");
    await settle();
    await perform(() => {
      latest().run(task);
    });
    await view.unmount();

    expect(runs[0]?.signal.aborted).toBe(false);
    await finish(runs[0], { ok: true, message: "Skipped." });
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  test("a second run neither cancels the first nor lets its late result win", async () => {
    const view = await mount(<Probe />);
    const first = slowTask();
    const second = slowTask();
    await perform(() => {
      latest().run(first.task);
    });
    await perform(() => {
      latest().run(second.task);
    });

    expect(first.runs[0]?.signal.aborted).toBe(false);
    await finish(second.runs[0], { ok: true, message: "Second." });
    expect(view.container.textContent).toBe("Second.");

    await finish(first.runs[0], { ok: true, message: "First." });
    expect(view.container.textContent).toBe("Second.");
    expect(first.task).toHaveBeenCalledTimes(1);
    expect(second.task).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  test("Retry runs the same task exactly once more", async () => {
    const view = await mount(<Probe />);
    const { task, runs } = slowTask();
    await perform(() => {
      latest().run(task);
    });
    await finish(runs[0], {
      ok: false,
      failure: { status: 0, code: "network", message: "", reference: null },
    });
    expect(view.container.textContent).toContain("could not be reached");

    await perform(() => {
      latest().retry();
    });
    expect(task).toHaveBeenCalledTimes(2);
    expect(view.container.textContent).toBe("pending");
    await finish(runs[1], { ok: true, message: "Done." });
    expect(view.container.textContent).toBe("Done.");
    await view.unmount();
  });
});
