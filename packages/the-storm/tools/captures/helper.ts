import { CaptureTransport } from "@shepherdjerred/mc-harness/capture/transport.ts";
import { createMessageControls } from "@shepherdjerred/mc-harness/capture/messages.ts";
import {
  ClientActionResponseSchema,
  ClientStatusResponseSchema,
} from "@shepherdjerred/mc-harness/protocol/client.ts";
import type { CaptureContext } from "@shepherdjerred/mc-harness/capture/define.ts";
import { PlayerCheckpointSchema } from "@shepherdjerred/mc-harness/protocol/capture.ts";

/** A second genuine session created for this disposable map, never a Citizens actor. */
export async function localHelper(context: CaptureContext) {
  if (context.target === "live")
    throw new Error("Demo helper commands require an isolated map copy");
  const name = "TsmcDemoHelper";
  const transport = new CaptureTransport(
    context.target,
    "Documentation helper on isolated real map",
    undefined,
    name,
  );
  const route = `/clients/${name}`;
  const status = async () =>
    transport.request(ClientStatusResponseSchema, "GET", route);
  const initial = await status();
  if (initial.client.target !== context.target || !initial.state.connected)
    throw new Error(
      "The real demo helper is not connected to this capture target",
    );
  const action = async (
    operation: string,
    args: Record<string, unknown> = {},
  ) => {
    const response = await transport.request(
      ClientActionResponseSchema,
      "POST",
      `${route}/${operation}`,
      args,
    );
    return response.result;
  };
  await action("close");
  const track = async (
    kind: Parameters<CaptureContext["track"]>[0],
    level: number,
  ) => {
    const read = () =>
      transport.world(PlayerCheckpointSchema, "capture-player", { name });
    const key = `track.${kind}`;
    const checkpoint = await read();
    const before = checkpoint.moduleState[key];
    if (before === undefined || !/^[0-5]$/u.test(before))
      throw new Error("Helper track checkpoint is unavailable");
    await context.prepare(
      `perks admin set ${name} ${kind} ${level.toString()}`,
      {
        kind: "command",
        command: `perks admin set ${name} ${kind} ${before}`,
      },
    );
    const deadline = performance.now() + 30_000;
    while (performance.now() < deadline) {
      const current = await read();
      if (current.moduleState[key] === level.toString()) return;
      await Bun.sleep(100);
    }
    throw new Error("Helper track did not reach its requested level");
  };
  return { name, status, action, track, ...createMessageControls(action) };
}
