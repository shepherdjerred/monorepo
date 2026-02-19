import { z } from "zod";
import { match } from "ts-pattern";

export type QueueType = z.infer<typeof QueueTypeSchema>;
export const QueueTypeSchema = z.enum([
  "solo",
  "flex",
  "clash",
  "aram clash",
  "aram",
  "arurf",
  "urf",
  "quickplay",
  "swiftplay",
  "arena",
  "brawl",
  "draft pick",
  "easy doom bots",
  "normal doom bots",
  "hard doom bots",
  "custom",
]);

// from https://static.developer.riotgames.com/docs/lol/queues.json
export function parseQueueType(input: number): QueueType | undefined {
  return match(input)
    .returnType<QueueType | undefined>()
    .with(0, () => "custom")
    .with(420, () => "solo")
    .with(400, () => "draft pick")
    .with(440, () => "flex")
    .with(450, () => "aram")
    .with(700, () => "clash")
    .with(720, () => "aram clash")
    .with(480, () => "swiftplay")
    .with(490, () => "quickplay")
    .with(900, () => "arurf")
    .with(1700, () => "arena")
    .with(2300, () => "brawl")
    .with(1900, () => "urf")
    .with(3130, () => "easy doom bots")
    .with(4220, () => "normal doom bots")
    .with(4250, () => "hard doom bots")
    .otherwise(() => {
      console.error(`unknown queue type: ${input.toString()}`);
      // eslint-disable-next-line unicorn/no-useless-undefined -- void not assignable to QueueType | undefined
      return undefined;
    });
}

export function queueTypeToDisplayString(queueType: QueueType): string {
  return match(queueType)
    .returnType<string>()
    .with("solo", () => "ranked solo")
    .with("flex", () => "ranked flex")
    .with("clash", () => "clash")
    .with("aram clash", () => "ARAM clash")
    .with("aram", () => "ARAM")
    .with("arurf", () => "ARURF")
    .with("urf", () => "URF")
    .with("arena", () => "arena")
    .with("brawl", () => "brawl")
    .with("easy doom bots", () => "doom bots")
    .with("normal doom bots", () => "doom bots")
    .with("hard doom bots", () => "doom bots")
    .with("custom", () => "custom")
    .with("draft pick", () => "draft pick")
    .with("quickplay", () => "quickplay")
    .with("swiftplay", () => "swiftplay")
    .exhaustive();
}
