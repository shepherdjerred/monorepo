import { z } from "zod";
import { defineCaptureScene } from "@shepherdjerred/mc-harness/capture/define.ts";
import { CaptureTransport } from "@shepherdjerred/mc-harness/capture/transport.ts";
import {
  CapturePreparationSchema,
  CapturePreparationResponseSchema,
} from "@shepherdjerred/mc-harness/protocol/capture.ts";
import { camera, chatVenue } from "#captures/scenes/fixtures.ts";
import shots from "#captures/presentations/essentials/mail.ts";
import { presentation } from "#captures/presentations/lookup.ts";

const fixture = z
  .strictObject({
    resource: z.string(),
    title: z.string(),
    choices: z
      .array(
        z.strictObject({
          id: z.string(),
          material: z.string(),
          amount: z.number().int().positive(),
        }),
      )
      .min(2),
  })
  .parse(
    await Bun.file(
      new URL(
        "../../../../plugin/modules/mail/src/main/resources/capture-mail-fixture.json",
        import.meta.url,
      ),
    ).json(),
  );
const selected = fixture.choices.find((c) => c.id === "iron");
if (selected === undefined)
  throw new Error("Mail fixture lacks its iron choice");
export default defineCaptureScene({
  name: "reward-mail-delivery",
  description:
    "Collect a real queued reward and verify that exactly one option is delivered",
  ...chatVenue,
  setup: async (context) => {
    await camera(context, [2.5, 0, 2.5], [12, 1, 12]);
    const transport = new CaptureTransport(
      context.target,
      "Prepare owned documentation mail",
      undefined,
      context.name,
    );
    const request = CapturePreparationSchema.parse({
      name: context.name,
      resource: fixture.resource,
      id: context.id.slice("capture-".length),
    });
    await transport.world(
      CapturePreparationResponseSchema,
      "capture-prepare",
      request,
    );
  },
  run: async (context) => {
    const id = z.uuid().parse(context.id.slice("capture-".length));
    await context.action("clear-overlays");
    await context.playerCommand("mail", fixture.title);
    await context.action("chat-open");
    await context.capture(presentation(shots, "mail-reward-pending"));
    await context.action("close");
    await context.action("clear-overlays");
    await context.playerCommand(
      `mail claim ${id} ${selected.id}`,
      "Collected 1 stacks. Your delivery is saved.",
    );
    await context.waitFor(
      "selected reward received exclusively",
      (s) =>
        s.connected &&
        s.inventory.some(
          (i) =>
            i.type === `minecraft:${selected.material.toLowerCase()}` &&
            i.count === selected.amount,
        ) &&
        !fixture.choices
          .filter((c) => c.id !== selected.id)
          .some((c) =>
            s.inventory.some(
              (i) => i.type === `minecraft:${c.material.toLowerCase()}`,
            ),
          ),
    );
    await context.action("clear-overlays");
    await context.playerCommand("mail", "You have no reward deliveries.");
    await context.action("chat-open");
    await context.capture(presentation(shots, "mail-reward-collected"));
    await context.action("close");
  },
});
