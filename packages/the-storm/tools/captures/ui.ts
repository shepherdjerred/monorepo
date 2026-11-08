import { z } from "zod";
import type { CaptureContext } from "@shepherdjerred/mc-harness/capture/define.ts";

const Screen = z.object({
  revision: z.string(),
  controls: z.array(
    z.object({
      id: z.number(),
      label: z.string(),
      enabled: z.boolean(),
      visible: z.boolean(),
    }),
  ),
});
export async function hasControl(context: CaptureContext, label: string) {
  const screen = Screen.parse(await context.action("screen-inspect"));
  return screen.controls.some(
    (c) => c.label === label && c.visible && c.enabled,
  );
}
/** Activate an observed, unambiguous native control; never guess pixel positions. */
export async function activate(context: CaptureContext, label: string) {
  const deadline = performance.now() + 10_000;
  let observed: string[] = [];
  while (performance.now() < deadline) {
    const screen = Screen.parse(await context.action("screen-inspect"));
    const controls = screen.controls.filter((c) => c.visible && c.enabled);
    observed = controls.map((c) => c.label);
    const matches = controls.filter((c) => c.label === label);
    if (matches.length > 1)
      throw new Error(`Ambiguous native control: ${label}`);
    const control = matches[0];
    if (control) {
      await context.action("screen-activate", {
        revision: screen.revision,
        id: control.id,
      });
      return;
    }
    await Bun.sleep(100);
  }
  throw new Error(
    `Missing native control ${label}; observed: ${observed.join(", ")}`,
  );
}
