import { z } from "zod";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { readPipedProcess } from "./discord-smoke-process.ts";

const ProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  running: z.boolean(),
});
const InstanceSchema = z.object({
  id: z.string().min(1),
  profileId: z.string().min(1),
  profileName: z.string().min(1),
  url: z.url(),
  status: z.string(),
});
const BrowserLocationSchema = z.object({
  url: z.url(),
});
const BrowserTextSchema = z.object({ text: z.string() });

async function runPinchTabJson(args: readonly string[]): Promise<unknown> {
  const stdout = await runPinchTab(args);
  const parsed: unknown = JSON.parse(stdout);
  return parsed;
}

async function runPinchTab(args: readonly string[]): Promise<string> {
  const child = Bun.spawn(["pinchtab", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return readPipedProcess(child, "PinchTab command failed");
}

async function resolveRunningInstance(profileName: string): Promise<{
  readonly profile: z.infer<typeof ProfileSchema>;
  readonly instance: z.infer<typeof InstanceSchema>;
}> {
  const profiles = z
    .array(ProfileSchema)
    .parse(await runPinchTabJson(["profiles", "--json"]));
  const profile = profiles.find((candidate) => candidate.name === profileName);
  if (profile === undefined) {
    throw new Error(
      `PinchTab profile ${profileName} does not exist; create it and sign into Discord once`,
    );
  }
  if (!profile.running) {
    throw new Error(
      `PinchTab profile ${profileName} is not running; start its signed-in instance before smoke testing`,
    );
  }
  const instances = z
    .array(InstanceSchema)
    .parse(await runPinchTabJson(["instance", "list", "--json"]));
  const instance = instances.find(
    (candidate) =>
      candidate.profileId === profile.id && candidate.status === "running",
  );
  if (instance === undefined) {
    throw new Error(
      `PinchTab profile ${profileName} has no running browser instance`,
    );
  }
  return { profile, instance };
}

export async function verifyPinchTabProfile(
  profileName: string,
  guildId: string,
  channelId: string,
): Promise<void> {
  const { instance } = await resolveRunningInstance(profileName);

  const channelUrl = `https://discord.com/channels/${guildId}/${channelId}`;
  await runPinchTabJson([
    "nav",
    "--server",
    instance.url,
    channelUrl,
    "--json",
  ]);
  const location = BrowserLocationSchema.parse(
    await runPinchTabJson(["url", "--server", instance.url, "--json"]),
  );
  if (new URL(location.url).pathname.startsWith("/login")) {
    throw new Error(
      `PinchTab profile ${profileName} is not signed into Discord; complete the one-time browser login before smoke testing`,
    );
  }
  if (location.url !== channelUrl) {
    throw new Error(
      `PinchTab profile ${profileName} could not open the smoke channel; reached ${location.url}`,
    );
  }
}

export async function captureDiscordMessage(input: {
  readonly profileName: string;
  readonly guildId: string;
  readonly channelId: string;
  readonly messageId: string;
  readonly expectedVisibleFragments: readonly string[];
  readonly outputPath: string;
}): Promise<void> {
  const { instance } = await resolveRunningInstance(input.profileName);
  const messageUrl = `https://discord.com/channels/${input.guildId}/${input.channelId}/${input.messageId}`;
  await runPinchTabJson([
    "nav",
    "--server",
    instance.url,
    messageUrl,
    "--json",
  ]);
  await runPinchTabJson([
    "wait",
    "--server",
    instance.url,
    "--text",
    input.expectedVisibleFragments[0] ?? "",
    "--timeout",
    "30000",
    "--json",
  ]);
  const page = BrowserTextSchema.parse(
    await runPinchTabJson([
      "text",
      "--server",
      instance.url,
      "--full",
      "--json",
    ]),
  );
  for (const fragment of input.expectedVisibleFragments) {
    if (!page.text.includes(fragment)) {
      throw new Error(
        `Discord client did not visibly render expected receipt text: ${fragment}`,
      );
    }
  }
  await mkdir(path.dirname(input.outputPath), { recursive: true });
  await runPinchTab([
    "screenshot",
    "--server",
    instance.url,
    "--output",
    input.outputPath,
    "--format",
    "png",
  ]);
}
