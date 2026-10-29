import { z } from "zod";

type Native = (
  action: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;
const MessagesSchema = z.object({
  cursor: z.number(),
  messages: z.array(z.object({ text: z.string() })),
});

/** Feedback is limited to messages received after the action being demonstrated. */
export function createMessageControls(native: Native) {
  let cursor = 0;
  const mark = async () => {
    cursor = MessagesSchema.parse(
      await native("messages", { since: 0 }),
    ).cursor;
  };
  const feedback = async (expected: string) => {
    const deadline = performance.now() + 30_000;
    while (performance.now() < deadline) {
      const messages = MessagesSchema.parse(
        await native("messages", { since: cursor }),
      );
      if (messages.messages.some((message) => message.text.includes(expected)))
        return;
      await Bun.sleep(100);
    }
    throw new Error(`Expected player feedback did not arrive: ${expected}`);
  };
  return {
    mark,
    feedback,
    command: async (text: string, expected: string) => {
      await mark();
      await native("command", { text });
      await feedback(expected);
    },
  };
}
